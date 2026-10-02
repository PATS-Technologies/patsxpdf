export function getUserInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let initials = "";

  if (words.length === 1) initials = words[0].slice(0, 3);
  else if (words.length === 2) initials = `${words[0].slice(0, 2)}${words[1].slice(0, 1)}`;
  else initials = words.slice(0, 3).map((word) => word.slice(0, 1)).join("");

  return initials.toLocaleUpperCase("pt-BR").slice(0, 3);
}