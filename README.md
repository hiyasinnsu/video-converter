# 🎬 クライアントサイド動画軽量化・変換ツール

スマートフォンのブラウザ上で完結し、**サーバーへの動画アップロードを一切行わずに（ギガ・通信量消費ゼロ）** 動画の解像度やビットレートを調整してファイルサイズを劇的に削減できるWebアプリケーションです。

---

## 🌟 特徴
- **通信量完全ゼロ (0バイト)**: 動画ファイルはお手元のスマートフォン端末内だけで処理されます。ギガを消費せず、プライベートな動画も安全です。
- **解像度・ビットレートの数値指定**:
  - 幅・高さをピクセル単位で直接入力可能（アスペクト比固定連動）。
  - ビットレート（kbps）のスライダー＆数値直接指定。
  - ワンタップ解像度プリセット（1080p, 720p, 480p, 360p, 50%縮小）。
- **スマホ最適化 (Mobile-First)**: タップしやすい大型ボタン、テンキー入力対応。
- **インストール不要・無料**: GitHub Pagesなどの静的Webサーバーに配置するだけで即座に誰でも利用可能。

---

## 🚀 GitHub Pages での公開手順

このアプリは静的ファイル（HTML / CSS / JavaScript）のみで構築されているため、GitHub Pages を使って**完全無料・サーバー契約不要**で公開できます。

### 手順 1. GitHub 上にリポジトリを作成
1. [GitHub](https://github.com/) にログインし、右上の「＋」→「New repository」をクリックします。
2. リポジトリ名を入力します（例: `video-converter`）。
3. 「Public」を選択し、「Create repository」をクリックします。

### 手順 2. ローカルからプッシュ
ターミナル（PowerShell等）で以下のコマンドを実行します：

```bash
# ファイルをステージングしてコミット
git add .
git commit -m "Initial commit: Video converter web app"

# mainブランチに変更
git branch -M main

# リモートリポジトリのURLを設定（ユーザー名とリポジトリ名はご自身のものに置き換えてください）
git remote add origin https://github.com/<あなたのGitHubユーザー名>/<リポジトリ名>.git

# プッシュ
git push -u origin main
```

### 手順 3. GitHub Pages の有効化
1. GitHubの該当リポジトリのページを開き、上部メニューの **「Settings」**（設定）をクリック。
2. 左メニューの **「Pages」** をクリック。
3. **「Build and deployment」** の **「Source」** で **「Deploy from a branch」** を選択。
4. **「Branch」** を **`main`**、フォルダを **`/ (root)`** に指定して **「Save」** をクリック。
5. 数分待つと、上部に以下のような公開URLが表示されます：
   `https://<あなたのGitHubユーザー名>.github.io/<リポジトリ名>/`

これでスマホのSafariやChromeから上記URLにアクセスするだけで、いつでもどこでも通信量ゼロで動画軽量化が利用できます！

---

## 🛠 技術構成
- HTML5 Canvas API (フレームスケーリング・縮小描画)
- HTML5 MediaRecorder API (クライアントサイド・ハードウェアエンコード)
- Web Audio API (音声トラックの同期キャプチャ・合成)
- ピュア Vanilla JavaScript & CSS3 (外部ライブラリ依存ゼロ)
