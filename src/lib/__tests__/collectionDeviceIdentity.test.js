import { afterEach, describe, expect, it, vi } from 'vitest';

const deviceId = '00000000-0000-4000-8000-000000000123';

vi.mock('@/lib/operatorSessionService', () => ({
  getDeviceId: () => deviceId,
}));

import {
  getCollectionDeviceId,
  nextCollectionDeviceSequence,
} from '@/lib/collectionDeviceIdentity';

describe('collectionDeviceIdentity', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('mantém uma sequência monotônica por device', async () => {
    expect(getCollectionDeviceId()).toBe(deviceId);
    expect(await nextCollectionDeviceSequence(deviceId)).toBe(1);
    expect(await nextCollectionDeviceSequence(deviceId)).toBe(2);
  });

  it('falha de forma segura no limite sem reiniciar em 1', async () => {
    localStorage.setItem(
      `acprod_collection_device_sequence:${deviceId}`,
      String(Number.MAX_SAFE_INTEGER),
    );

    await expect(nextCollectionDeviceSequence(deviceId)).rejects.toMatchObject({
      code: 'COLLECTION_DEVICE_SEQUENCE_EXHAUSTED',
      retryable: false,
    });
    expect(localStorage.getItem(`acprod_collection_device_sequence:${deviceId}`))
      .toBe(String(Number.MAX_SAFE_INTEGER));
  });
});
