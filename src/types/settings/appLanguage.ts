// Sprachpräferenz der Anwendung ("auto" = Browser-Spracherkennung, sonst BCP-47-Locale-Code wie "en" oder "de")
type AppLanguage = "auto" | (string & {});

export default AppLanguage;
