import chalk from 'chalk';
import { stripVTControlCharacters } from 'node:util';
import { createNumericPlanetFrame } from '../../numericPlanetFrame.mjs';

export function isTerminalAnimationDisabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.HAPPIER_NO_ANIMATION ?? '').trim().toLowerCase());
}

/** Numeric brand texture only; no identifiers, credentials or progress data. */
export function renderNumericPlanet(options: Readonly<{
  columns?: number;
  seconds?: number;
  chalkLike?: typeof chalk;
  color?: boolean;
}> = {}): string[] {
  const colors = options.chalkLike ?? chalk;
  return createNumericPlanetFrame({
    ...(options.columns === undefined ? {} : { columns: options.columns }),
    ...(options.seconds === undefined ? {} : { seconds: options.seconds }),
  }).map((row) => {
    const line = row.map((cell) => {
      if (!cell) return ' ';
      return options.color === false || colors.level === 0
        ? cell.digit
        : colors.rgb(...cell.rgb)(cell.digit);
    }).join('');
    return line.trimEnd();
  });
}

export function renderSetupWelcome(options: Readonly<{
  machineName: string;
  subtitle: string;
  columns?: number;
}>): string {
  // The bootstrapper already introduced Happier. Keep this operation's context,
  // but do not restart the visual welcome when it hands over to guided setup.
  if (process.env.HAPPIER_INSTALLER_WELCOME_SHOWN === '1') {
    return ['', options.subtitle, `Computer: ${options.machineName}`, ''].join('\n');
  }
  const rich = Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb';
  const width = options.columns ?? process.stdout.columns ?? 80;
  const lines = rich && width >= 40 && (process.stdout.rows ?? 24) >= 18
    ? renderNumericPlanet({ color: !process.env.NO_COLOR })
    : [];
  return [...lines, '', 'Happier', options.subtitle, `Computer: ${options.machineName}`, ''].join('\n');
}

export type SetupChoice = Readonly<{
  id?: string;
  key: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}>;

export type SetupChoiceRenderOptions = Readonly<{
  machineName: string;
  subtitle: string;
  question: string;
  description?: string;
  choices: readonly SetupChoice[];
  columns?: number;
  rows?: number;
  isTTY?: boolean;
  seconds?: number;
  selectedId?: string;
  showWelcome?: boolean;
}>;

export type SetupChoicePrompt = Readonly<{
  message: string;
  animate?: boolean;
  renderMessage?: (elapsedSeconds: number, selectedId?: string) => string;
}>;

const SETUP_PLANET_WIDTH = 24;
const SETUP_PLANET_GAP = 3;
const SETUP_MIN_RIGHT_WIDTH = 42;

function wrapSetupText(value: string, width: number, indent = ''): string[] {
  const available = Math.max(12, width - indent.length);
  const words = value.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [indent];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > available) {
      lines.push(`${indent}${line}`);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(`${indent}${line}`);
  return lines;
}

function renderSetupChoiceText(options: SetupChoiceRenderOptions, width: number, showBrand: boolean, color: boolean): string[] {
  const gold = (value: string): string => color ? chalk.hex('#d6a24a')(value) : value;
  const title = (value: string): string => color ? chalk.bold(value) : value;
  const lines: string[] = [];
  if (options.showWelcome !== false) {
    if (showBrand) lines.push(title('Happier'));
    lines.push(...wrapSetupText(options.subtitle, width));
    lines.push(...wrapSetupText(`Computer: ${options.machineName}`, width), '');
  }
  lines.push(...wrapSetupText(options.question, width).map((line) => gold(title(line))));
  if (options.description) lines.push(...wrapSetupText(options.description, width));
  const selectedId = options.selectedId ?? options.choices.find((choice) => choice.isDefault)?.id ?? options.choices.find((choice) => choice.isDefault)?.key;
  for (const choice of options.choices) {
    const selected = (choice.id ?? choice.key) === selectedId;
    const prefix = `${selected ? '›' : ' '} ${choice.key}) `;
    const labelLines = wrapSetupText(choice.label, width, ' '.repeat(prefix.length));
    const firstLabel = labelLines[0]!.slice(prefix.length);
    lines.push(selected
      ? gold(title(`${prefix}${firstLabel}`))
      : `${gold(`  ${choice.key})`)} ${firstLabel}`);
    for (const continuation of labelLines.slice(1)) {
      lines.push(selected ? gold(title(continuation)) : continuation);
    }
    if (choice.description) {
      lines.push(...wrapSetupText(choice.description, width, ' '.repeat(prefix.length)));
    }
  }
  return lines;
}

function canRenderSetupChoiceRich(options: SetupChoiceRenderOptions, width: number, rows: number, isTTY: boolean, showBrand: boolean): boolean {
  if (!isTTY || process.env.TERM === 'dumb' || width < SETUP_PLANET_WIDTH + SETUP_PLANET_GAP + SETUP_MIN_RIGHT_WIDTH) {
    return false;
  }
  const rightWidth = width - SETUP_PLANET_WIDTH - SETUP_PLANET_GAP;
  const rightLineCount = renderSetupChoiceText(options, rightWidth, showBrand, false).length;
  const planetLineCount = Math.ceil(SETUP_PLANET_WIDTH / 2.2);
  return Math.max(rightLineCount, planetLineCount) + 2 < rows;
}

/**
 * Render the welcome and setup's actual first choice as one bounded block.
 * The answer remains a normal line prompt below it; this function owns no input
 * or cursor state and is safe to use as a stable animation frame.
 */
export function renderSetupChoice(options: SetupChoiceRenderOptions): string {
  const width = Math.max(20, Math.floor(options.columns ?? process.stdout.columns ?? 80));
  const rows = options.rows ?? process.stdout.rows ?? 24;
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  const showBrand = process.env.HAPPIER_INSTALLER_WELCOME_SHOWN !== '1';
  const color = isTTY && process.env.TERM !== 'dumb' && !process.env.NO_COLOR && chalk.level > 0;
  const rich = options.showWelcome !== false && canRenderSetupChoiceRich(options, width, rows, isTTY, showBrand);
  if (!rich) {
    const prompt = isTTY && process.env.TERM !== 'dumb'
      ? 'Use ↑/↓ to move, Enter to select, or type a letter'
      : 'Choose';
    return [...renderSetupChoiceText(options, width, showBrand, color), '', prompt].join('\n');
  }

  const rightWidth = width - SETUP_PLANET_WIDTH - SETUP_PLANET_GAP;
  const right = renderSetupChoiceText(options, rightWidth, showBrand, color);
  const planet = renderNumericPlanet({
    columns: SETUP_PLANET_WIDTH,
    seconds: options.seconds ?? 0,
    color: !process.env.NO_COLOR,
  });
  const lines: string[] = [];
  for (let index = 0; index < Math.max(planet.length, right.length); index += 1) {
    const left = planet[index] ?? '';
    const content = right[index] ?? '';
    const paddedLeft = `${left}${' '.repeat(Math.max(0, SETUP_PLANET_WIDTH - stripVTControlCharacters(left).length))}`;
    lines.push(content ? `${paddedLeft}${' '.repeat(SETUP_PLANET_GAP)}${content}` : left);
  }
  return [...lines, '', 'Use ↑/↓ to move, Enter to select, or type a letter'].join('\n');
}

export function createSetupChoicePrompt(options: SetupChoiceRenderOptions): SetupChoicePrompt {
  const message = renderSetupChoice(options);
  const width = Math.max(20, Math.floor(options.columns ?? process.stdout.columns ?? 80));
  const rows = options.rows ?? process.stdout.rows ?? 24;
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  const showBrand = process.env.HAPPIER_INSTALLER_WELCOME_SHOWN !== '1';
  const rich = options.showWelcome !== false && canRenderSetupChoiceRich(options, width, rows, isTTY, showBrand);
  const canNavigate = isTTY && process.env.TERM !== 'dumb';
  const canAnimate = !isTerminalAnimationDisabled() && rich;
  return canNavigate
    ? {
        message,
        animate: canAnimate,
        renderMessage: (elapsedSeconds, selectedId) => renderSetupChoice({ ...options, seconds: elapsedSeconds, selectedId }),
      }
    : { message };
}
