import { HostAskError, type FilePickerRequest, type PickedFile } from '@almadar/shell-runtime/kernel/host';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new HostAskError('unavailable', `${file.name} could not be read`)));
    reader.onerror = () => reject(new HostAskError('unavailable', `${file.name} could not be read`));
    reader.readAsDataURL(file);
  });
}

/** `browser/open-file-picker` on the web: a detached file input, so it works on every browser and on phones; closing it answers `cancelled`. */
export function pickFiles(request: FilePickerRequest): Promise<readonly PickedFile[]> {
  if (typeof document === 'undefined') return Promise.reject(new HostAskError('unavailable', 'this host has no document to open a file picker from'));
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = request.multiple;
  if (request.accept !== '') input.accept = request.accept;
  return new Promise((resolve, reject) => {
    input.addEventListener('cancel', () => reject(new HostAskError('cancelled', 'the file picker was closed')), { once: true });
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return reject(new HostAskError('cancelled', 'no file was picked'));
      Promise.all(files.map(async (file) => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, content: await readAsDataUrl(file) }))).then(resolve, reject);
    }, { once: true });
    input.click();
  });
}
