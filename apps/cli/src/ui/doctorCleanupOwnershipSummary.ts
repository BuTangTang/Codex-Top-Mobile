export type DoctorCleanupOwnershipSummary = Readonly<{
  title: string;
  lines: readonly string[];
}>;

export function renderDoctorCleanupOwnershipSummary(params: Readonly<{
  ownerLabel: string;
  serviceManaged: boolean | null;
}>): DoctorCleanupOwnershipSummary | null {
  const ownerLabel = params.ownerLabel.trim();
  if (!ownerLabel) {
    return null;
  }

  const lines = [
    `Current status: ${ownerLabel}`,
    'This cleanup guidance does not switch the running daemon.',
  ];

  if (params.serviceManaged === true) {
    lines.push('Use `happier doctor repair` if you want automatic startup to switch to this installation.');
  } else if (params.serviceManaged === false) {
    lines.push('Use `happier daemon restart` if you want the manual start to switch to this installation.');
  } else {
    lines.push('Restart the running daemon before trying to switch this installation.');
  }

  return {
    title: 'Cleanup ownership summary',
    lines,
  };
}
