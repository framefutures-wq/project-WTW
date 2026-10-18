export function requireRemoteReadApproval(args, scriptName) {
  if (!args.includes("--remote")) return;
  if (args.includes("--allow-expensive-remote-read")) return;
  throw new Error(
    `${scriptName}: remote D1 전체 읽기는 기본 차단됩니다. ` +
      `로컬 snapshot을 사용하거나, 필요성과 대상 환경을 확인한 뒤 ` +
      `--remote --allow-expensive-remote-read를 함께 지정하세요.`,
  );
}

export function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}
