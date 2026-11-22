export const APP_DOCUMENT_TITLE = "Logic Circuit Web";
export const DIRTY_TITLE_PREFIX = "●";

// Formatiert den HTML-Seitentitel inklusive optionalem Dateinamen und Dirty-Indikator für ungespeicherte Änderungen
export function formatDocumentTitle(
  activeFileName: string | null | undefined,
  hasUnsavedChanges: boolean,
): string {
  const fileName = activeFileName?.trim() ?? "";
  const baseTitle = fileName ? `${fileName} – ${APP_DOCUMENT_TITLE}` : APP_DOCUMENT_TITLE;
  return hasUnsavedChanges ? `${DIRTY_TITLE_PREFIX} ${baseTitle}` : baseTitle;
}
