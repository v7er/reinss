import { add } from './math.js';

export function total(values: number[]): number {
  return values.reduce((sum, value) => add(sum, value), 0);
}
