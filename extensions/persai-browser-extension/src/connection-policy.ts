export function shouldKeepBridgeConnection(input: {
  keepalivePortCount: number;
  activeCommandCount: number;
  registrationUpdatedAt: number | null;
  now: number;
  registrationMaxAgeMs: number;
}): boolean {
  const hasFreshRegistration =
    input.registrationUpdatedAt !== null &&
    input.now - input.registrationUpdatedAt <= input.registrationMaxAgeMs;
  return input.keepalivePortCount > 0 || input.activeCommandCount > 0 || hasFreshRegistration;
}
