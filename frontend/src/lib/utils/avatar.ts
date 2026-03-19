/**
 * user.id (UUID) 기반으로 일관된 파스텔 색상 생성
 * HSL: 채도 55%, 명도 82% — 부드럽고 읽기 쉬운 파스텔 팔레트
 */
export function getPastelColor(seed: string): { bg: string; text: string } {
  // 간단한 해시 → 0~360 hue
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg:   `hsl(${hue}, 55%, 82%)`,
    text: `hsl(${hue}, 45%, 32%)`,
  };
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
