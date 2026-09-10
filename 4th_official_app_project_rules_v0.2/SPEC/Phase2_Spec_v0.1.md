# 第4審判 交代管理Webアプリ
## Phase 2 開発仕様書 v0.1

## 0. 位置づけ

Phase 1（`Phase1_Spec_v0.2.md`）は完成・実戦投入済み。Phase 2 v0.1 は、
その交代管理を **壊さずに** 第4審が試合中に扱う重要イベントの記録機能を
追加するもの。

### 今回の追加範囲
1. 得点記録
2. カード記録（警告・退場、チーム役員含む）
3. 既存の交代履歴を含めた「統合試合タイムライン」

### 今回の対象外（勝手に追加しない）
通常交代ルールセット、AT機能、一時退出／再入場、用具確認、詳細な自由
記述メモ、クラウド／複数端末同期、PDF試合レポート、大会ルールプリセット、
**退場選手の出場不可状態管理**、【PENDING】事項の解釈・解決。

## 1. 基本方針（Phase 1 を守る）

- `engine.ts`、`reentryPolicy.ts`、`SubstitutionPanel.tsx`、`clock.ts`、
  `matchSetup.ts`、`matchTypes.ts` は **無変更**。
- 得点・カードは `substitutionEvents` とは別の配列（`goalEvents` /
  `cardEvents`）として `AppState` に持ち、`replayMatch` / `engine.ts` から
  一切読まれない。
- スコア・「警告◯枚目」・タイムライン順は保存せず、生イベント配列から
  毎回計算する（`matchRecord.ts`）。編集・取消のたびに自動で正しくなる。
- 【CONFIRMED】9名 / 後半3回 / 再交代3名、通常交代・再出場の自動判定は
  一切変更しない。赤カードはこれらに影響しない。

## 2. 得点

### 2.1 操作
`得点` → `HOME / AWAY` → `得点者の背番号` → `確定`
- 試合時計の現在の経過時間を自動記録する。
- 得点は前半・後半（ボールインプレー中）のみ記録できる。

### 2.2 データ（`GoalEvent`）
```text
id / phase / elapsedMs
teamId              その得点が入るチーム（OGは利益を得るチーム）
scorerNumber | null  null = 得点者未確認
ownGoal            オウンゴールか
ownGoalByNumber | null  入れてしまった相手選手の背番号。null = 背番号不明
```

### 2.3 スコア表示
- 画面上部（時計の下）に `HOME ● 2 - 1 ● AWAY` の形で常時表示。色ドット
  ＋チーム名ラベルを併用（色のみに依存しない）。
- スコアは `goalEvents` を数えて算出する独立データ。手入力しない。
- 得点履歴の編集・取消でスコアを自動再計算する。

### 2.4 得点者未確認
- 「得点者未確認」で保存できる（得点数には数える）。
- あとから履歴編集で背番号を登録できる。

### 2.5 オウンゴール
- 得点者選択で「オウンゴール」を選ぶと、相手選手の背番号を任意で選べる
  （「背番号不明」で省略可）。得点は選択中のチームに入る。
- 例：`前半 18:22  HOME  ⚽ OG（AWAY #4）`

## 3. カード

### 3.1 操作
`カード` → `HOME / AWAY` → `対象（選手 or チーム役員）` → `🟨 警告 / 🟥 退場` → `確定`
- 試合時計の現在の経過時間を自動記録する。
- カードは前半・ハーフタイム・後半・試合終了後に記録できる。

### 3.2 データ（`CardEvent`）
```text
id / phase / elapsedMs / teamId
card                'YELLOW' | 'RED'
targetType          'PLAYER' | 'OFFICIAL'
playerNumber | null       PLAYER のとき
officialRole | null       OFFICIAL のとき（監督 / コーチ / スタッフ / その他）
officialName             OFFICIAL の任意テキスト（未入力なら空）
```

### 3.3 同一選手への複数警告
- 対象の背番号を選んだ時点で、その選手に既に警告があれば
  「この選手には警告が◯枚記録されています」と非拘束で表示する。
- アプリは「2枚目だから退場」と審判判断を確定しない。
- タイムライン上、その選手の2枚目以降の警告は「🟨 警告 #6（2枚目）」の
  ように何枚目か表示する（枚数は生データから毎回計算、取消で自動再計算）。

### 3.4 チーム役員へのカード
- 監督 / コーチ / スタッフ / その他 を選べる。名前入力は任意。
- 例：`後半 35:10  AWAY  🟨 警告 監督（山田）`

### 3.5 退場カードと交代ロジックの関係（v0.1 の確定方針）
- v0.1 では退場（赤）カードは **記録・表示・編集・取消のみ**。交代パネル・
  `engine.ts`・リエントリー判定・9名／3回／3名判定には **接続しない**。
- 退場選手の出場不可状態管理は【FUTURE】のまま維持する。将来、退場状態
  管理を正式実装する段階で、交代候補・再入場可否・人数状態まで含めて
  一貫して設計する（v0.1 では中途半端な警告表示も追加しない）。

## 4. 統合試合タイムライン

Phase 1 の「交代履歴」を「試合タイムライン」に拡張する。既存の交代
イベントは消さず・作り直さず、同じ時系列上に次を表示する。

- 得点 / カード / 交代
- 前半開始 / 前半終了 / 後半開始 / 試合終了（`clock` から算出する目印）
- 飲水（`hydrationCompletionElapsedMsByHalf` に記録した時刻に1回／ハーフ）
- 既存の「同じプレー停止」グループ（HOME/AWAYを1枠にまとめる表示を維持）

### 4.1 並び順
`(フェーズ, 経過時間)` 昇順。フェーズ順は 前半 < ハーフタイム < 後半 <
試合終了後。フェーズ境界の目印は各フェーズの先頭・末尾に置く。

### 4.2 表示
- HOME/AWAY は色ドット＋チーム名ラベルの両方で判別できる（色のみに
  依存しない）。得点は ⚽ ＋「得点」、警告は 🟨 ＋「警告」、退場は 🟥 ＋
  「退場」のように絵文字＋文字を併用。
- ハーフタイム・試合終了後の記録は時刻を出さず「ハーフタイム」「試合
  終了後」と表示する。

### 4.3 編集・取消
- 得点・カードも Phase 1 と同じく編集・取消できる。取消は2段階タップ。
- 変更後は現在状態（スコア・警告枚数・タイムライン）を再計算する。
- 交代の編集で後続の交代が不成立になる場合の `NEEDS_REVIEW` 表示は
  Phase 1 のまま。得点・カードは `replayMatch` に入らないため、これらの
  編集・取消が `NEEDS_REVIEW` を生むことはない（スコア／枚数の再計算のみ）。

## 5. UI（試合中）

- 試合画面に「⚽ 得点」「🟨🟥 カード」の入口を置く。タップでその場に
  入力パネルが開き、確定／キャンセルで閉じる。画面遷移しない。
- 「得点」はボールインプレー中のみ表示。「カード」は常時。
- 入力項目は最小限（チーム→対象→種別→確定）。

## 6. オフライン・保存

- 得点・カード・スコア・タイムライン・編集・取消は、Phase 1 と同じく
  ネット接続なしで動作する（すべて端末内の `localStorage` で完結）。
- `AppState` に増えたフィールド（`goalEvents` / `cardEvents` /
  `hydrationCompletionElapsedMsByHalf`）は、`persistence.loadMatchState`
  で未保存時に安全な既定値を補完する。Phase 1 で保存済みの試合データを
  Phase 2 版で読み込んでも壊れない。
- PWA（サービスワーカー・マニフェスト・GitHub Pages 配信）は無変更。

## 7. 変更ファイル

- 追加：`src/domain/matchRecord.ts`（`deriveScore` / `countPlayerYellows` /
  `playerYellowOrdinal` / `buildTimeline` / `formatTimelineMoment`）、
  `src/components/GoalEntryPanel.tsx`、`CardEntryPanel.tsx`、
  `MatchTimeline.tsx`、`TeamBadge.tsx`
- 変更（追加のみ）：`src/domain/types.ts`（`GoalEvent` / `CardEvent` 型）、
  `src/domain/matchStore.ts`（`AppState` にフィールド追加、得点・カードの
  record/update/delete、飲水完了時刻の記録）、`src/domain/persistence.ts`
  （既定値補完）、`src/App.tsx`（配線）、`src/components/MatchScreen.tsx`
  （スコア表示・入口・タイムライン差し替え）
- 削除：`src/components/SubstitutionHistory.tsx`（内容は `MatchTimeline.tsx`
  へ移動）
