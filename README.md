# appsync-on-rails

## 今できること、使い方

### 前提

- [serverless appsync plugin](https://github.com/sid88in/serverless-appsync-plugin) および serverless framework の上で動くようになっているため、以下のような要領でアプリケーションを実装する必要がある。
- ゆくゆくは `rails new` のようなコマンドでテンプレートから生やせるようにはしたい

```
.
├── package.json
├── serverless.yml
├── resources
│ ├── appsync
│ └── dynamodb
├── mapping-templates
└── schema.graphql
```

### インストール

`yarn add appsync-on-rails -D`

### schema.graphql から周辺リソースを生やす

`yarn appsync-on-rails`

すると、以下のディレクトリに設定ファイルを出力する。

- resources/appsync 以下に、 `*.mapping.yml` (appsync に食わせる Type/field とデータソースのマッピング設定ファイル)
- resources/dynamodb 以下に、 `*.resource.yml` (dynamodb のリソース定義ファイル)
- schema 以下に、`*.graphql` (各タイプ固有の、CRUD オペレーションを表現する graphql スキーマ)
- mapping-templates 以下に、`*.*.request/response.vtl`(appsync のリゾルバ定義)

あくまでも、「新しい設定ファイルを出力する」にすぎないため、  
serverless.yml 側では適宜それらを読み込むよう設定が必要。

### コマンドライン引数

- `appsync-on-rails --help` で参照可能。
- `--append-only` (既存ファイルを上書きしなくなる)
  や `---types` (指定の graphql Type のみに処理を実行する) などは便利だと思う

### 利用可能な directive

```
directive @model on OBJECT # タイプ名と同じ名前のdynamodbテーブルを作る。
directive @connection on FIELD_DEFINITION # フィールドを、その型のタイプ名と同じdynamodbテーブルと紐づける。
```

#### model

```
type Customer @model {
  id: ID!
  name: String
}
```

- `@model` をつけると、dynamodb のリソースおよび CRUD オペレーションのスキーマ定義、また CRUD オペレーションのリゾルバの実装が生えてくる。

#### connection

- `@connection` をつけると、状況に応じて dynamodb の GSI のリソースおよび コネクションを表現する リゾルバの実装が生えてくる。

##### has_one (お互いに)

```
type Customer {
  defaultCard: Card @connection(name: "CustomerDefaultCard", myKey: "cardId")
}

type Card {
  owner: Customer @connection(name: "CustomerDefaultCard", myKey: "ownerId")
}

```

この場合、以下のように結合する。

- Customer => Card  
  Card テーブルの id キー（プライマリキー）に、 Customer テーブルの cardId フィールドの値を渡して GetItem する
- Card => Customer
  Customer テーブルの id キー（プライマリキー）に、 Card テーブルの ownerId フィールドの値を渡して GetItem する

##### has_one（同じ ID）

```
type Customer {
  user: User @connection(name: "UserCustomer")
}

type User {
  customer: Customer @connection(name: "UserCustomer" )
}

```

- `@connection` ディレクティブにキー名を何も渡さなかった場合、相互に ID が同じという前提で参照する。

##### has_many / belongs_to

```
type Customer @model {
  cards: [Card] @connection(name: "CustomerCard", yourKey: "ownerId")
}

type Card @model {
  owner: Customer @connection(name: "CustomerCard", myKey: "ownerId")
}

```

- `@connection` ディレクティブで、myKey フィールドを指定した場合、自動で name フィールドに渡した名称の GSI が dynamodb に張られる。

- Customer => Card  
  Card テーブルの CustomerCard という GSI の ownerId キーに Customer テーブルの ID フィールドを渡し、Query でリストを取得する

- Card => Customer
  Customer テーブルの ID キーに Card テーブルの ownerId フィールドを渡し、GetItem で取得する

## 問題意識

### serverless 界の Rails を作りたい

- [Amplify API](https://docs.amplify.aws/lib/graphqlapi/getting-started/q/platform/js) が体験としてかなり近い
- ただ、Amplify は Rails と違って本格的な web アプリをつくるのには不向き

### フレームワークはどうあるべきか

- スタンドアロン であること  
  それ自体が依存する先は極力少なくあるべきで、ソースコードを読んだ他の開発者が**想像できる範囲**でのこと以外をしてはならない。

- 面倒な作業をなくしてくれること  
  この点においては Amplify は既にかなりの成果を上げているといってよい。  
  逆にこれができていないとフレームワークとは呼べないそもそもの部分になる

- いつでも剥がせること、開発者はその気になればすべてをコントロール下におけること  
  Amplify やその他の FW/ツールが圧倒的に弱い部分。  
  本 FW は、この部分を重視して開発する

### 周辺の状況(2020 年現在)

|            |      楽       |     大変      |
| :--------- | :-----------: | :-----------: |
| 拡張性あり | ☆gql-on-rails | serverless FW |
| 拡張性なし |    Amplify    |    手作業     |

### いつでも剥がせる状態を実現するためには

- ランタイムに干渉しない
- プロジェクトルート外のものを管理しない
