// SQL のコンパイルだけを検証したい単体テスト専用のダミー DB。
// テストからしか使わないので、tsconfig.server.json の exclude で本番ビルド
// （dist/）から除外している（`npm run build` の成果物を --omit=dev で
// インストールしたときに devDependencies が要らないようにするため）。

import {
  DummyDriver, Kysely, MysqlAdapter,
  MysqlIntrospector, MysqlQueryCompiler,
} from 'kysely';
import type { Database } from './schema.js';
import type { Db } from './create-db.js';

/**
 * SQL のコンパイルだけを行うダミー DB。`DummyDriver` は接続もクエリ実行も
 * 一切行わず、`.execute()` してもエラーにはならず常に空の結果（0 行）を
 * 返すだけなので、使い道は `.compile()` で生成 SQL とバインド値を見ること
 * に限られる。
 *
 * `createDb` と取り違えて合成ルート（本番のクエリ実行経路）に紛れ込むと、
 * 例外で落ちて気づけるのではなく「クエリは成功するがデータが常に 0 件」
 * という気づきにくい壊れ方をする。テストファイル以外から import しないこと。
 */
export function createTestDb(): Db {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  });
}
