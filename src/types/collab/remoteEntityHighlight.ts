// Lokale Darstellungsdaten für fremde Bauteil-/Notiz-/Leitungs-Selektionen im Canvas
type CollabRemoteSelectionOwner = {
  peerId: string;
  displayName: string;
  color: string;
  hasOpenDialog?: boolean;
};

export default CollabRemoteSelectionOwner;
