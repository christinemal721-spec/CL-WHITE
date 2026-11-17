/**
 * 模型只接受 JPEG / PNG / GIF / WebP 四种图片（按文件内容判断，不看扩展名和 MIME）。
 * 其余格式（BMP、TIFF、AVIF、ICO、SVG、HEIC 等）发出去会被整段请求拒绝：
 * 「You have uploaded an unsupported image」，而且历史里的图每一轮都会随上下文重发，
 * 于是之后无论发什么都报错。上传前先按内容识别，不支持的在浏览器里转成 JPEG；转不了就不发。
 */

export class UnsupportedImageError extends Error {
  constructor() {
    super('unsupported image')
    this.name = 'UnsupportedImageError'
  }
}

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** 按文件头识别模型支持的四种格式；其他一律返回空字符串 */
export const sniffSupportedImage = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') {
    return 'image/gif'
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return ''
}

export const isSupportedImageType = (type: string) => SUPPORTED.has(type)

/** 转换时的最长边：再大也看不出区别，还容易超出 iOS 的画布上限 */
const MAX_SIDE = 4096

const decode = async (blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> => {
  try {
    const bitmap = await createImageBitmap(blob)
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  } catch {
    // SVG 等 createImageBitmap 不认的格式，交给 <img> 解码（Safari 还能解 HEIC、TIFF）
    const url = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.decoding = 'async'
      image.src = url
      await image.decode()
      const width = image.naturalWidth || 1024
      const height = image.naturalHeight || 1024
      return { source: image, width, height, close: () => URL.revokeObjectURL(url) }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  }
}

const jpegName = (name: string) => {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name || 'image'}.jpg`
}

/**
 * 保证图片是模型支持的格式：支持的原样返回（补上正确的 MIME），其余转成 JPEG。
 * 浏览器解不开的抛出 UnsupportedImageError。
 */
export const toSupportedImage = async (
  blob: Blob,
  name: string
): Promise<{ blob: Blob; name: string }> => {
  const type = await sniffSupportedImage(blob)
  if (type) {
    return { blob: blob.type === type ? blob : new Blob([blob], { type }), name }
  }
  let decoded: Awaited<ReturnType<typeof decode>>
  try {
    decoded = await decode(blob)
  } catch {
    throw new UnsupportedImageError()
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new UnsupportedImageError()
    }
    // JPEG 没有透明通道，透明部分垫白底
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(decoded.source, 0, 0, width, height)
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!jpeg || jpeg.size === 0) {
      throw new UnsupportedImageError()
    }
    return { blob: jpeg, name: jpegName(name) }
  } catch {
    throw new UnsupportedImageError()
  } finally {
    decoded.close()
  }
}
