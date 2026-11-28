// Rollen in einer Kollaborations-Session (Einladungsrollen ohne Host-Rechte sowie der autoritative Host)
export type CollabInviteRole = "collaborator" | "guest";

type CollabRole = "host" | CollabInviteRole;

export default CollabRole;
