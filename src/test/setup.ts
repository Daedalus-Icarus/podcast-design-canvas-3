import '@testing-library/jest-dom';

// jsdom does not implement URL.createObjectURL / revokeObjectURL.
let counter = 0;
const urlCtor = URL as unknown as {
  createObjectURL?: (o: unknown) => string;
  revokeObjectURL?: (u: string) => void;
};
if (typeof urlCtor.createObjectURL !== 'function') {
  urlCtor.createObjectURL = () => `blob:stub/${counter++}`;
}
if (typeof urlCtor.revokeObjectURL !== 'function') {
  urlCtor.revokeObjectURL = () => undefined;
}
