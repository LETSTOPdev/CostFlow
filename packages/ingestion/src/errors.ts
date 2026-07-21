/**
 * Structural problems with an import source itself (not row-level data
 * quality), for every provider. These fail the import loudly: proceeding
 * would misread the source while looking healthy (R-04/R-05), or silently
 * repair an ambiguous history (Slice 2 Part C). Renamed from CsvImportError
 * in P2 when the class started serving all providers (D-16).
 */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
