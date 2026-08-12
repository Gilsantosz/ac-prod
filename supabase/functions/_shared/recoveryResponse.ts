export const GENERIC_RECOVERY_BODY = Object.freeze({
  success: true,
  message: 'Se o e-mail estiver cadastrado, as instruções foram processadas.',
});

export function genericRecoveryBody() {
  return { ...GENERIC_RECOVERY_BODY };
}

export async function waitForComparableRecoveryTiming(startedAt: number, minimumMs = 650) {
  const jitterMs = Math.floor(Math.random() * 151);
  const remaining = minimumMs + jitterMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
