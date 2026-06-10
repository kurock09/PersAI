const audioOwners = new Map<string, () => void>();

export function releaseAudioFocus(ownerId: string): void {
  audioOwners.delete(ownerId);
}

export function requestAudioFocus(ownerId: string, stop: () => void): () => void {
  for (const [otherOwnerId, otherStop] of audioOwners.entries()) {
    if (otherOwnerId === ownerId) {
      continue;
    }
    try {
      otherStop();
    } finally {
      audioOwners.delete(otherOwnerId);
    }
  }

  audioOwners.set(ownerId, stop);

  return () => {
    if (audioOwners.get(ownerId) === stop) {
      audioOwners.delete(ownerId);
    }
  };
}
