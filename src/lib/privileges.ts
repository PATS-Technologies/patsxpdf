export function canAccess(privileges: string[], requested: string) {
  if (privileges.includes("admin")) return true;
  const [resource, rawLevel = "0"] = requested.toLowerCase().split("-");
  const level = Number(rawLevel);
  return privileges.some((code) => {
    const [candidateResource, candidateLevel = "0"] = code.toLowerCase().split("-");
    return candidateResource === resource && Number(candidateLevel) >= level;
  });
}
