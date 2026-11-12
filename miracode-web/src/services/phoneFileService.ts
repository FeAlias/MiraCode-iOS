import { nativeBridge } from './nativeBridge';

export function toSafeFileName(name: string, ext = 'tsx'): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'program';
  return `${slug}.${ext}`;
}

/**
 * Saves program code directly to the iPhone "Files" app via the native iOS share
 * sheet ("Save to Files" -> On My iPhone / iCloud Drive), falling back to Web Share
 * or direct file download when running outside the native shell.
 */
export async function saveProgramToPhoneFiles(
  programName: string,
  code: string
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const fileName = toSafeFileName(programName, 'tsx');

  if (nativeBridge.isRunningInNativeApp()) {
    const shared = await nativeBridge.shareFile(fileName, code);
    if (shared) {
      return 'shared';
    }
  }

  const file = new File([code], fileName, { type: 'text/plain;charset=utf-8' });

  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;

  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    try {
      if (nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: fileName,
        });
        return 'shared';
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  downloadProgramDirectly(programName, code);
  return 'downloaded';
}

export function downloadProgramDirectly(programName: string, code: string): void {
  const fileName = toSafeFileName(programName, 'tsx');
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
