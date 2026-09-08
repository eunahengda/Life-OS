// react-native-web ships no TypeScript declarations of its own. This app
// only ever needs its raw-DOM-element escape hatch (used by DateField.web
// and TimeField.web to render real <input>/<select> elements — see Task
// 030), so this declares just that one export rather than pulling in a
// full, unofficial type package for a library whose React Native surface
// is already covered by @types/react-native.
declare module 'react-native-web' {
  export function unstable_createElement(
    component: string,
    props: Record<string, unknown>,
  ): JSX.Element;
}
