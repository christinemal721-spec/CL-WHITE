import { Inflate } from 'fflate'

const READ_CHUNK_BYTES = 256 * 1024
// 控制每轮同步解压的工作量；输出交给调用方保存后才继续读取。
const INFLATE_CHUNK_BYTES = 8 * 1024

/** ZIP 结构损坏或使用了不支持的特性 */
export class ArchiveError extends Error {
  constructor() {
    super('Invalid or unsupported history archive')
    this.name = 'ArchiveError'
  }
}

const invalid = (): never => {
  throw new ArchiveError()
}

/** 本地文件头签名 PK\x03\x04，用于在解析前区分 ZIP 与其他文件。 */
export const isZipFile = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return bytes.length === 4 && bytes.every((byte, index) => byte === [0x50, 0x4b, 3, 4][index])
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return crc >>> 0
})

const readBytes = async (file: File, start: number, length: number) => {
  if (start < 0 || length < 0 || start + length > file.size) {
    invalid()
  }
  const bytes = new Uint8Array(await file.slice(start, start + length).arrayBuffer())
  if (bytes.length !== length) {
    invalid()
  }
  return bytes
}

const MAX32 = 0xffffffff
const MAX16 = 0xffff

const getUint64 = (view: DataView, offset: number) => {
  const value = view.getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalid()
  }
  return Number(value)
}

/**
 * 检查扩展字段格式，返回 ZIP64 扩展字段（id 1）的内容；没有时为 null。
 * 大于 4GB 或条目超过 65535 个的归档（以及部分压缩工具）会用 ZIP64 记录真实大小与偏移。
 */
const checkExtra = (bytes: Uint8Array): DataView | null => {
  const view = viewOf(bytes)
  let offset = 0
  let zip64: DataView | null = null
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) {
      invalid()
    }
    const id = view.getUint16(offset, true)
    const length = view.getUint16(offset + 2, true)
    if (offset + 4 + length > bytes.length) {
      invalid()
    }
    if (id === 1) {
      if (zip64) {
        invalid()
      }
      zip64 = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, length)
    }
    offset += 4 + length
  }
  return zip64
}

/** 按 ZIP64 规则依次取出被标成 0xFFFFFFFF 的字段 */
const zip64Reader = (extra: DataView | null) => {
  let cursor = 0
  return (value: number) => {
    if (value !== MAX32) {
      return value
    }
    if (!extra || cursor + 8 > extra.byteLength) {
      return invalid()
    }
    const result = getUint64(extra, cursor)
    cursor += 8
    return result
  }
}

const decodePath = (bytes: Uint8Array, flags: number) => {
  // 非 UTF-8 编码的 ZIP 文件名仅接受 ASCII，确保附件路径解码准确。
  if (!(flags & 0x800) && bytes.some((byte) => byte > 0x7f)) {
    invalid()
  }
  const path = new TextDecoder('utf-8', { fatal: true }).decode(bytes).normalize('NFC')
  if (!path || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path)) {
    invalid()
  }
  const parts = (path.endsWith('/') ? path.slice(0, -1) : path).split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    invalid()
  }
  return path
}

type Entry = {
  path: string
  name: Uint8Array
  flags: number
  method: number
  crc: number
  compressedSize: number
  size: number
  offset: number
}

const readDirectory = async (file: File): Promise<{ entries: Entry[]; offset: number }> => {
  if (file.size < 22) {
    invalid()
  }
  const tailStart = Math.max(0, file.size - 22 - 0xffff)
  const tail = await readBytes(file, tailStart, file.size - tailStart)
  const tailView = viewOf(tail)
  let end = tail.length - 22
  while (
    end >= 0 &&
    (tailView.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + tailView.getUint16(end + 20, true) !== tail.length)
  ) {
    end--
  }
  if (end < 0) {
    invalid()
  }
  let count = tailView.getUint16(end + 10, true)
  let size = tailView.getUint32(end + 12, true)
  let offset = tailView.getUint32(end + 16, true)
  /** 中央目录之后紧跟的记录（普通结尾或 ZIP64 结尾）的位置 */
  let directoryEnd = tailStart + end
  if (
    tailView.getUint16(end + 4, true) !== 0 ||
    tailView.getUint16(end + 6, true) !== 0 ||
    tailView.getUint16(end + 8, true) !== count
  ) {
    invalid()
  }
  if (count === MAX16 || size === MAX32 || offset === MAX32) {
    // ZIP64：结尾前 20 字节是定位器，指向 ZIP64 结尾记录
    const locatorStart = tailStart + end - 20
    if (locatorStart < 0) {
      invalid()
    }
    const locator = viewOf(await readBytes(file, locatorStart, 20))
    if (locator.getUint32(0, true) !== 0x07064b50 || locator.getUint32(4, true) !== 0) {
      invalid()
    }
    const recordStart = getUint64(locator, 8)
    const record = viewOf(await readBytes(file, recordStart, 56))
    if (
      record.getUint32(0, true) !== 0x06064b50 ||
      record.getUint32(16, true) !== 0 ||
      record.getUint32(20, true) !== 0 ||
      getUint64(record, 24) !== getUint64(record, 32)
    ) {
      invalid()
    }
    count = getUint64(record, 32)
    size = getUint64(record, 40)
    offset = getUint64(record, 48)
    directoryEnd = recordStart
  }
  if (offset + size !== directoryEnd) {
    invalid()
  }
  const entries: Entry[] = []
  const paths = new Set<string>()
  // 中央目录一次读进来再解析：上万个条目时逐条读文件会非常慢（尤其 iOS）
  const directory = await readBytes(file, offset, size)
  const slice = (start: number, length: number) => directory.subarray(start, start + length)
  let cursor = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > size) {
      invalid()
    }
    const view = viewOf(slice(cursor, 46))
    if (view.getUint32(0, true) !== 0x02014b50) {
      invalid()
    }
    const flags = view.getUint16(8, true)
    const method = view.getUint16(10, true)
    const nameLength = view.getUint16(28, true)
    const extraLength = view.getUint16(30, true)
    const next = cursor + 46 + nameLength + extraLength + view.getUint16(32, true)
    if (next > size) {
      invalid()
    }
    const zip64 = zip64Reader(
      checkExtra(slice(cursor + 46 + nameLength, extraLength))
    )
    // ZIP64 扩展字段的顺序固定：原始大小、压缩后大小、本地头偏移
    const entrySize = zip64(view.getUint32(24, true))
    const compressedSize = zip64(view.getUint32(20, true))
    const entryOffset = zip64(view.getUint32(42, true))
    // 只允许 deflate 选项、data descriptor 与 UTF-8 标志。
    if (
      flags & ~0x80e ||
      (method !== 0 && method !== 8) ||
      (method === 0 && compressedSize !== entrySize) ||
      entryOffset >= offset ||
      view.getUint16(34, true) !== 0 ||
      ((view.getUint32(38, true) >>> 16) & 0xf000) === 0xa000 ||
      next > size
    ) {
      invalid()
    }
    const name = slice(cursor + 46, nameLength)
    const path = decodePath(name, flags)
    // 目录和同名文件也不能互相覆盖。
    const identity = path.endsWith('/') ? path.slice(0, -1) : path
    if (paths.has(identity) || (path.endsWith('/') && entrySize !== 0)) {
      invalid()
    }
    paths.add(identity)
    entries.push({
      path,
      name,
      flags,
      method,
      crc: view.getUint32(16, true),
      compressedSize,
      size: entrySize,
      offset: entryOffset,
    })
    cursor = next
  }
  if (cursor !== size) {
    invalid()
  }
  return { entries: entries.sort((a, b) => a.offset - b.offset), offset }
}

const readEntryOffset = async (file: File, entry: Entry, boundary: number) => {
  if (entry.offset + 30 > boundary) {
    invalid()
  }
  const view = viewOf(await readBytes(file, entry.offset, 30))
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (
    view.getUint32(0, true) !== 0x04034b50 ||
    view.getUint16(6, true) !== entry.flags ||
    view.getUint16(8, true) !== entry.method ||
    nameLength !== entry.name.length ||
    end > boundary
  ) {
    invalid()
  }
  const metadata = await readBytes(file, entry.offset + 30, nameLength + extraLength)
  if (entry.name.some((byte, index) => byte !== metadata[index])) {
    invalid()
  }
  const localExtra = checkExtra(metadata.subarray(nameLength))
  const deferred = Boolean(entry.flags & 8)
  const crc = view.getUint32(14, true)
  if (crc !== entry.crc && !(deferred && crc === 0)) {
    invalid()
  }
  // 本地头里的大小：可能是 ZIP64 标记、也可能因为 data descriptor 写成 0
  const local = zip64Reader(localExtra)
  const localSize = local(view.getUint32(22, true))
  const localCompressed = local(view.getUint32(18, true))
  for (const [actual, expected] of [
    [localCompressed, entry.compressedSize],
    [localSize, entry.size],
  ]) {
    if (actual !== expected && !(deferred && actual === 0)) {
      invalid()
    }
  }
  if (deferred) {
    if (end + 12 > boundary) {
      invalid()
    }
    const descriptor = viewOf(await readBytes(file, end, Math.min(24, boundary - end)))
    const shift = descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0
    const matches32 =
      shift + 12 <= descriptor.byteLength &&
      descriptor.getUint32(shift + 4, true) === entry.compressedSize &&
      descriptor.getUint32(shift + 8, true) === entry.size
    // ZIP64 的 data descriptor 用 8 字节记大小
    const matches64 =
      shift + 20 <= descriptor.byteLength &&
      Number(descriptor.getBigUint64(shift + 4, true)) === entry.compressedSize &&
      Number(descriptor.getBigUint64(shift + 12, true)) === entry.size
    if (
      shift + 12 > descriptor.byteLength ||
      descriptor.getUint32(shift, true) !== entry.crc ||
      !(matches32 || matches64)
    ) {
      invalid()
    }
  }
  return start
}

export type ArchiveEntry = {
  path: string
  size: number
  /** 条目在文件中的结束位置，用于计算导入进度 */
  end: number
  stream: AsyncIterable<Uint8Array>
}

/**
 * 按条目在文件中的物理顺序逐条、逐块解压，跳过目录条目。
 * 调用方必须消费完当前条目的数据，再请求下一个条目。
 */
/** 压缩工具顺手塞进去的系统文件：macOS 的 __MACOSX/ 与 .DS_Store、Windows 的缩略图缓存 */
const isJunk = (path: string) => {
  const name = path.split('/').at(-1) ?? ''
  return (
    path.startsWith('__MACOSX/') ||
    path.includes('/__MACOSX/') ||
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    name === 'desktop.ini' ||
    name.startsWith('._')
  )
}

/** 导出格式里条目的先后：manifest → user → 会话 JSON → index → 图片 */
const rankOf = (path: string) =>
  path === 'manifest.json'
    ? 0
    : path === 'user.json'
      ? 1
      : /^chat_sessions\/[^/]+\.json$/.test(path)
        ? 2
        : path === 'chat_session_index.json'
          ? 3
          : 4

/**
 * 解压后又重新压缩的归档（手机「文件」里压缩、Windows 发送到压缩文件夹、Mac 右键压缩）常见三种变化：
 * 外面多套一层文件夹、条目顺序被打乱、混进系统文件。读之前统一整理回导出时的样子：
 * 去掉公共的外层文件夹，跳过系统文件，按导出格式的顺序读（ZIP 本来就能按偏移随意读取）。
 */
const normalizeEntries = (entries: Entry[]) => {
  const files = entries.filter((entry) => !entry.path.endsWith('/') && !isJunk(entry.path))
  let prefix = ''
  if (!files.some((entry) => entry.path === 'manifest.json')) {
    const manifest = files.find((entry) => entry.path.endsWith('/manifest.json'))
    const candidate = manifest ? manifest.path.slice(0, -'manifest.json'.length) : ''
    if (candidate && files.every((entry) => entry.path.startsWith(candidate))) {
      prefix = candidate
    }
  }
  return files
    .map((entry) => ({ entry, path: entry.path.slice(prefix.length) }))
    .sort((a, b) => rankOf(a.path) - rankOf(b.path) || a.entry.offset - b.entry.offset)
}

export async function* readArchive(file: File): AsyncGenerator<ArchiveEntry> {
  const directory = await readDirectory(file)
  // 每个条目的数据边界按文件里的实际位置算，和读取顺序无关
  const byOffset = directory.entries.toSorted((a, b) => a.offset - b.offset)
  const boundaries = new Map(
    byOffset.map((entry, index) => [entry, byOffset[index + 1]?.offset ?? directory.offset])
  )
  for (const { entry, path } of normalizeEntries(directory.entries)) {
    const boundary = boundaries.get(entry) ?? directory.offset
    const start = await readEntryOffset(file, entry, boundary)
    let completed = false
    const stream = async function* (): AsyncGenerator<Uint8Array> {
      let written = 0
      let crc = 0xffffffff
      const pending: Uint8Array[] = []
      const append = (chunk: Uint8Array) => {
        written += chunk.length
        if (written > entry.size) {
          invalid()
        }
        for (let index = 0; index < chunk.length; index++) {
          crc = (crc >>> 8) ^ crcTable[(crc ^ chunk[index]) & 0xff]
        }
        if (chunk.length) {
          pending.push(chunk)
        }
      }
      const inflate = entry.method === 8 ? new Inflate(append) : null
      for (let offset = 0; offset < entry.compressedSize; offset += READ_CHUNK_BYTES) {
        const chunk = await readBytes(
          file,
          start + offset,
          Math.min(READ_CHUNK_BYTES, entry.compressedSize - offset)
        )
        if (!inflate) {
          append(chunk)
          yield* pending.splice(0)
          continue
        }
        for (let cursor = 0; cursor < chunk.length; cursor += INFLATE_CHUNK_BYTES) {
          const end = Math.min(cursor + INFLATE_CHUNK_BYTES, chunk.length)
          inflate.push(chunk.subarray(cursor, end), offset + end === entry.compressedSize)
          // yield 暂停解压，等待调用方完成异步写入；不缓存整个条目。
          yield* pending.splice(0)
        }
      }
      if (inflate && entry.compressedSize === 0) {
        inflate.push(new Uint8Array(), true)
        yield* pending.splice(0)
      }
      if (written !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) {
        invalid()
      }
      completed = true
    }
    yield { path, size: entry.size, end: start + entry.compressedSize, stream: stream() }
    if (!completed) {
      invalid()
    }
  }
}

/** 读出整个条目：会话 JSON 需要完整解析，图片需要识别类型后整张保存。 */
export const readEntry = async (entry: ArchiveEntry): Promise<Blob> => {
  const parts: Blob[] = []
  for await (const chunk of entry.stream) {
    parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]))
  }
  return new Blob(parts)
}

/** 不需要的条目也要读完，以校验大小与 CRC。 */
export const skipEntry = async (entry: ArchiveEntry): Promise<void> => {
  const reader = entry.stream[Symbol.asyncIterator]()
  while (!(await reader.next()).done) {
    // 丢弃数据。
  }
}
