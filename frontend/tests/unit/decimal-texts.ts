/** Typed decimal texts and whether the one grammar (domain/json) accepts them. */
export const decimalTexts: readonly [text: string, accepted: boolean][] = [
  ["+1", true],
  [".5", true],
  ["5.", true],
  ["1e3", true],
  ["-012.50e1", true],
  ["1E+2", true],
  ["0", true],
  ["1e", false],
  [".", false],
  ["e3", false],
  ["0x10", false],
  ["1,5", false],
  ["1 2", false],
  ["", false],
];
