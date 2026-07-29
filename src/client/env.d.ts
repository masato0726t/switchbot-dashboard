// Vue の単一ファイルコンポーネントを TypeScript から import できるようにする宣言。
// 実際の型付けは vue-tsc が行い、素の tsc はこの宣言で解決する。

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
