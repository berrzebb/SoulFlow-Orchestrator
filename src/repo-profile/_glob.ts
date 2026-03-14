/**
 * repo-profile 내부 전용 glob 패턴 매칭 유틸리티.
 * "**\/" = 선택적 경로 접두사, "**" = 임의 문자, "*" = 슬래시 제외 임의 문자.
 * 문자별 파싱으로 이중 치환 오염 방지.
 */
export function match_glob(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let i = 0;
  let re = "";
  while (i < escaped.length) {
    if (escaped[i] === "*" && escaped[i + 1] === "*") {
      if (escaped[i + 2] === "/") {
        re += "(.*/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (escaped[i] === "*") {
      re += "[^/]*";
      i++;
    } else {
      re += escaped[i++];
    }
  }
  return new RegExp("^" + re + "$").test(path);
}
