/** The browser's half of `backup-file.ts`: a download, and a file input. */
export type SaveOutcome = 'saved' | 'shared' | 'cancelled';

export async function saveBackupFile(name: string, json: string): Promise<SaveOutcome> {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked late: the download reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'saved';
}

/** Must be called from the press itself — a browser only opens the picker on a user gesture. */
export function pickBackupFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    const done = (value: Promise<string> | null) => {
      input.remove();
      if (value) value.then(resolve, reject);
      else resolve(null);
    };
    input.addEventListener('change', () => done(input.files?.[0]?.text() ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}
