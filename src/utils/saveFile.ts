/**
 * 把生成好的文件交给用户保存：支持分享文件的设备（iPhone 等）走系统分享，可存到「文件」；
 * 其余直接下载。必须在点击事件里同步调用，iPhone 才允许弹出分享面板。
 * 用户在分享面板点了取消返回 false。
 */
export const saveFile = async (file: File): Promise<boolean> => {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] })
      return true
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return false
    }
    // 分享失败（权限、系统限制）时退回下载
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}
