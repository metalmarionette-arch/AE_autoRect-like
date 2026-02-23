#target aftereffects
#targetengine "SUGI_ScriptLancher"

/**
 * AE_SUGI_ScriptLancher_v01_05.jsx
 * - タブ再編:
 *   ・新規「エミッター」タブを追加（エミッター作成_円／枠 を移動）
 *   ・「GG分解」をモーション系タブへ移動
 * - バージョン非依存ローダーで最新版を選択起動（素材I/O／モーション系／その他すべて）
 */

(function (thisObj) {
  var TITLE = "SUGI_ScriptLancher";

  // ---- 読み込み先（Documents配下）----
  // 既定:
  //   %USERPROFILE%\Documents\Adobe\After Effects\AE_SUGI_ScriptLancher\
  //   ├─ Scripts\
  //   └─ png\
  function getSugiRootFolder() {
    try {
      var doc = Folder.myDocuments; // ユーザーごとのDocuments
      var root = new Folder(doc.fsName + "/Adobe/After Effects/AE_SUGI_ScriptLancher");
      if (!root.exists) root.create();
      return root;
    } catch (e) {
      return null;
    }
  }

  function getPngFolder() {
    try {
      var root = getSugiRootFolder();
      if (!root) return null;
      var dir = new Folder(root.fsName + "/png");
      // pngフォルダは存在しなくても動作はする（アイコン無しでボタン化）
      return dir;
    } catch (e) {
      return null;
    }
  }

  // ---- アイコンキャッシュ（同一pngを何度もnewImageしない）----
  function getCachedImage(fileObj) {
    try {
      if (!fileObj || !fileObj.exists) return null;
      var g = $.global;
      if (!g.__SUGI_ICONCACHE__) g.__SUGI_ICONCACHE__ = {};
      var k = fileObj.fsName;
      if (g.__SUGI_ICONCACHE__[k]) return g.__SUGI_ICONCACHE__[k];
      var img = ScriptUI.newImage(fileObj);
      g.__SUGI_ICONCACHE__[k] = img;
      return img;
    } catch (e) {
      return null;
    }
  }


  // ---- Scripts/ サブフォルダ ----
  function getScriptsFolder() {
    try {
      var root = getSugiRootFolder();
      if (!root) return null;
      var dir = new Folder(root.fsName + "/Scripts");
      if (!dir.exists) dir.create();
      return dir;
    } catch (e) {
      return null;
    }
  }


  function listFiles(dir) {
    if (!dir || !dir.exists) return [];
    var arr = dir.getFiles(function (f) {
      return f instanceof File && (/\.jsx$/i).test(f.name);
    });
    return arr || [];
  }

  // 文字列→バージョン配列（例: "1_10_3" → [1,10,3]）
  function parseVersion(verStr) {
    if (!verStr) return null;
    var parts = (verStr + "").split(/[\._]/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var n = parseInt(parts[i], 10);
      out.push(isNaN(n) ? 0 : n);
    }
    return out;
  }

  // バージョン配列比較（長さ差は0埋め）
  function cmpVersion(a, b) {
    var len = Math.max(a.length, b.length);
    for (var i = 0; i < len; i++) {
      var ai = (i < a.length) ? a[i] : 0;
      var bi = (i < b.length) ? b[i] : 0;
      if (ai > bi) return 1;
      if (ai < bi) return -1;
    }
    return 0;
  }

  // base から最適スクリプトを解決（バージョン付き優先）
  function resolveVersionedScript(base) {
    var dir = getScriptsFolder();
    if (!dir || !dir.exists) return null;

    var files = listFiles(dir);
    var re = new RegExp("^(" + base + ")_v(\\d+(?:[\\._]\\d+)*)\\.jsx$", "i");
    var best = null;
    var bestVer = null;

    // 1) バージョン付き候補から最大を選択
    for (var i = 0; i < files.length; i++) {
      var name = files[i].name;
      var m = name.match(re);
      if (m) {
        var verArr = parseVersion(m[2]);
        if (verArr) {
          if (!best || cmpVersion(verArr, bestVer) > 0) {
            best = files[i];
            bestVer = verArr;
          }
        }
      }
    }
    if (best) return best;

    // 2) フォールバック: バージョンなし "<base>.jsx"
    var fallback = File(dir.fsName + "/" + base + ".jsx");
    if (fallback.exists) return fallback;

    return null;
  }

  // 固定ファイル名で実行（互換目的）
  function runFromScriptsExact(basename) {
    var dir = getScriptsFolder();
    if (!dir || !dir.exists) {
      alert("Scripts フォルダが見つかりません。");
      return;
    }
    var f = File(dir.fsName + "/" + basename);
    if (!f.exists) {
      alert("Scripts フォルダ内に \"" + basename + "\" が見つかりません。");
      return;
    }
    try { $.evalFile(f); } catch (e) { alert("実行中にエラー:\n" + e.toString()); }
  }

  // base名から最新版を実行
  function runFromScriptsVersioned(base) {
    var f = resolveVersionedScript(base);
    if (!f) {
      alert("Scripts フォルダから \"" + base + "_v*.jsx\" または \"" + base + ".jsx\" を見つけられませんでした。");
      return;
    }
    try { $.evalFile(f); } catch (e) { alert("実行中にエラー:\n" + e.toString()); }
  }

  // ---- UI ----
  function buildUI(thisObj) {
    var win = (thisObj instanceof Panel)
      ? thisObj
      : new Window("palette", TITLE, undefined, { resizeable: false });

    try { win.text = TITLE; } catch (_) {}

    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.margins = 10;
    // ---- Icons（Documents配下の png フォルダから読む）----

    function getIconImage(fileName) {
      var dir = getPngFolder();
      if (!dir || !dir.exists) return null;

      var f = File(dir.fsName + "/" + fileName);
      if (!f.exists) return null;

      // ★キャッシュして再利用
      return getCachedImage(f);
    }


    // 画像があれば iconbutton / 無ければ通常 button（保険）
    function addIconButton(parent, label, iconFileName) {
      var img = getIconImage(iconFileName);
      var btn;

      if (img) {
        btn = parent.add("iconbutton", undefined, img, { style: "toolbutton" });
        btn.helpTip = label;          // ホバーで説明
        btn.preferredSize = [32, 32]; // 4つ横並びで見やすいサイズ
      } else {
        btn = parent.add("button", undefined, label);
      }

      return btn;
    }

    // タブパネル
    var tabs = win.add("tabbedpanel", undefined, undefined, {});
    tabs.alignChildren = ["fill", "fill"];
    tabs.margins = 6;
    tabs.preferredSize = [380, 280];


    // --- Tab: フォルダツール（残存ユーティリティのみ） ---
    var tabTools = tabs.add("tab", undefined, "フォルダツール");
    tabTools.orientation = "column";
    tabTools.alignChildren = ["fill", "top"];
    tabTools.margins = 10;

    // ★4つのアイコンを横1列に配置
    var grpFolderIcons = tabTools.add("group", undefined);
    grpFolderIcons.orientation = "row";
    grpFolderIcons.alignChildren = ["left", "center"];
    grpFolderIcons.spacing = 8;
    grpFolderIcons.margins = 0;
    grpFolderIcons.alignment = ["fill", "top"];

    var btnMoveToFolder        = addIconButton(grpFolderIcons, "選択のフォルダ移動",      "移動 2 (0-00-00-00).png");
    var btnMoveToNewFolder     = addIconButton(grpFolderIcons, "選択のフォルダIN（個別）", "IN 2 (0-00-00-00).png");
    var btnMoveToNewAllFolder  = addIconButton(grpFolderIcons, "選択のフォルダIN（ALL）",  "ALLIN 2 (0-00-00-00).png");
    var btnFolderOut           = addIconButton(grpFolderIcons, "選択フォルダの削除",       "削除 2 (0-00-00-00).png");

    var btnPrecompShift  = tabTools.add("button", undefined, "プリコン+10");

    // ★追加：プリコン+10 の下に2ボタン
    var btnParentLayer   = tabTools.add("button", undefined, "AE_parentLayer");
    var btnPinNull       = tabTools.add("button", undefined, "AE_pin_null");

    btnMoveToFolder.onClick  = function(){ runFromScriptsVersioned("AE_m"); };
    btnMoveToNewFolder.onClick  = function(){ runFromScriptsVersioned("AE_FolderIN"); };
    btnMoveToNewAllFolder.onClick  = function(){ runFromScriptsVersioned("AE_FolderALLIN"); };
    btnFolderOut.onClick  = function(){ runFromScriptsVersioned("AE_FolderOUT"); };
    btnPrecompShift.onClick  = function(){ runFromScriptsVersioned("AE_precompose_insertLevel"); };

    // ★追加分の実行
    btnParentLayer.onClick = function(){ runFromScriptsVersioned("AE_parentLayer"); };
    btnPinNull.onClick     = function(){ runFromScriptsVersioned("AE_pin_null"); };


    // --- Tab: コンポツール（バージョン非依存で起動） ---
    var tabIO = tabs.add("tab", undefined, "コンポツール");
    tabIO.orientation = "column";
    tabIO.alignChildren = ["fill", "top"];
    tabIO.margins = 10;

    // ★コンポツール：追加（アイコン）
    var grpCompIcons = tabIO.add("group", undefined);
    grpCompIcons.orientation = "row";
    grpCompIcons.alignChildren = ["left", "center"];
    grpCompIcons.spacing = 8;
    grpCompIcons.margins = 0;
    grpCompIcons.alignment = ["fill", "top"];

    var btnMarkerUtility = addIconButton(grpCompIcons, "MarkerUtility", "MarkerUtility (0-00-00-00).png");
    var btnCompDuplicat   = addIconButton(grpCompIcons, "CompDuplicator", "CompDuplicator (0-00-00-00).png");
    var btnBookmark       = addIconButton(grpCompIcons, "CompBookmark", "CompBookmark (0-00-00-00).png");

    btnMarkerUtility.onClick = function(){ runFromScriptsVersioned("AE_MarkerUtility"); };


    btnCompDuplicat.onClick   = function(){ runFromScriptsVersioned("AE_CompDuplicator"); };
    btnBookmark.onClick   = function(){ runFromScriptsVersioned("AE_CompBookmark"); };


    // --- Tab: 素材I/O（バージョン非依存で起動） ---
    var tabIO = tabs.add("tab", undefined, "素材管理");
    tabIO.orientation = "column";
    tabIO.alignChildren = ["fill", "top"];
    tabIO.margins = 10;

    var btnFolderImport   = tabIO.add("button", undefined, "素材一括読み込み");
    var btnFootageReplace = tabIO.add("button", undefined, "素材一括置き換え");
    var btnFolderReload   = tabIO.add("button", undefined, "素材一括再読み込み");

    btnFolderImport.onClick   = function(){ runFromScriptsVersioned("AE_FolderImporter"); };
    btnFootageReplace.onClick = function(){ runFromScriptsVersioned("AE_FootageReplacer"); };
    btnFolderReload.onClick   = function(){ runFromScriptsVersioned("AE_FolderReload"); };


    // --- Tab: エミッター ---
    var tabEmitter = tabs.add("tab", undefined, "エミッター");
    tabEmitter.orientation = "column";
    tabEmitter.alignChildren = ["fill", "top"];
    tabEmitter.margins = 10;

    var btnEmitterCircle = tabEmitter.add("button", undefined, "エミッター作成_円");
    var btnEmitterRect   = tabEmitter.add("button", undefined, "エミッター作成_枠");

    // エミッターは固定名で起動（既存ファイル名が一定のため）
    btnEmitterCircle.onClick = function(){ runFromScriptsVersioned("AE_makeEmitter"); };
    btnEmitterRect.onClick   = function(){ runFromScriptsVersioned("AE_makeEmitterRect"); };


    // --- Tab: モーション系 ---
    var tabMotion = tabs.add("tab", undefined, "モーション");
    tabMotion.orientation = "column";
    tabMotion.alignChildren = ["fill", "top"];
    tabMotion.margins = 10;

    // ★ アイコンを2段にする（上段/下段）
    var grpMotionWrap = tabMotion.add("group", undefined);
    grpMotionWrap.orientation = "column";
    grpMotionWrap.alignChildren = ["fill", "top"];
    grpMotionWrap.spacing = 8;
    grpMotionWrap.margins = 0;
    grpMotionWrap.alignment = ["fill", "top"];

    // 上段
    var grpMotionIconsTop = grpMotionWrap.add("group", undefined);
    grpMotionIconsTop.orientation = "row";
    grpMotionIconsTop.alignChildren = ["left", "center"];
    grpMotionIconsTop.spacing = 8;
    grpMotionIconsTop.margins = 0;
    grpMotionIconsTop.alignment = ["fill", "top"];

    // 下段
    var grpMotionIconsBottom = grpMotionWrap.add("group", undefined);
    grpMotionIconsBottom.orientation = "row";
    grpMotionIconsBottom.alignChildren = ["left", "center"];
    grpMotionIconsBottom.spacing = 8;
    grpMotionIconsBottom.margins = 0;
    grpMotionIconsBottom.alignment = ["fill", "top"];

    // --- Tab: モーション系（アイコンボタン） ---
    var btnUniqName    = addIconButton(grpMotionIconsTop,    "UniqName",        "UniqName (0-00-00-00).png");
    var btnpricon     = addIconButton(grpMotionIconsTop,    "pricon",        "pricon (0-00-00-00).png");
    var btnFlowLite     = addIconButton(grpMotionIconsTop,    "FlowLite",        "FlowLite (0-00-00-00).png");
    var btnRandomMotion = addIconButton(grpMotionIconsTop,    "RandomMotion",    "randamM (0-00-00-00).png");
    var btnSequencer    = addIconButton(grpMotionIconsTop,    "Sequencer Offset","sequencerOffset (0-00-00-00).png");
    var btnAutoRect     = addIconButton(grpMotionIconsTop,    "AutoRect-like",   "AutoRect (0-00-00-00).png");
    var btnAnimSelect   = addIconButton(grpMotionIconsTop,    "AnimSelect",      "AnimSelect (0-00-00-00).png");
    var btnKeyMove      = addIconButton(grpMotionIconsTop, "KeyMove",         "KeyMove (0-00-00-00).png");
    var btnPosScale     = addIconButton(grpMotionIconsTop,    "PosScale",        "PosScale (0-00-00-00).png");

    var btnRectGen   = addIconButton(grpMotionIconsBottom, "RectGen",      "RectGen (0-00-00-00).png");
    var btnReSizeFont   = addIconButton(grpMotionIconsBottom, "reSizeFont",      "reSizeFont (0-00-00-00).png");
    var btnShapeSync    = addIconButton(grpMotionIconsBottom, "ShapeSync",       "ShapeSync (0-00-00-00).png");
    var btnSplitPos     = addIconButton(grpMotionIconsBottom, "splitPos",        "splitPos (0-00-00-00).png");
    var btnUnSplitPos     = addIconButton(grpMotionIconsBottom, "UnsplitPos",        "UnsplitPos (0-00-00-00).png");
    var btnPrecompTail     = addIconButton(grpMotionIconsBottom, "UPrecompTail",        "PrecompTail (0-00-00-00).png");
    var btnAnchorPivot  = addIconButton(grpMotionIconsBottom, "AnchorPivot",     "AnchorPivot (0-00-00-00).png");

    btnpricon.onClick = function(){ runFromScriptsVersioned("AE_pricon"); };
    btnRandomMotion.onClick = function(){ runFromScriptsVersioned("AE_RandomMotion"); };
    btnSequencer.onClick    = function(){ runFromScriptsVersioned("AE_Sequencer_Offset_UI"); };
    btnFlowLite.onClick     = function(){ runFromScriptsVersioned("AE_FlowLite_main"); };
    btnAutoRect.onClick     = function(){ runFromScriptsVersioned("AE_autoRect-like"); };
    btnAnimSelect.onClick   = function(){ runFromScriptsVersioned("AE_AnimSelect"); };
    btnPosScale.onClick     = function(){ runFromScriptsVersioned("AE_PosScale"); };
    btnReSizeFont.onClick   = function(){ runFromScriptsVersioned("AE_reSizeFont"); };
    btnShapeSync.onClick    = function(){ runFromScriptsVersioned("AE_ShapeSync"); };
    btnSplitPos.onClick     = function(){ runFromScriptsVersioned("AE_splitPos"); };
    btnUnSplitPos.onClick     = function(){ runFromScriptsVersioned("AE_UnsplitPos"); };
    btnPrecompTail.onClick     = function(){ runFromScriptsVersioned("AE_PrecompTail"); };
    btnKeyMove.onClick      = function(){ runFromScriptsVersioned("AE_KeyMove"); };
    btnAnchorPivot.onClick  = function(){ runFromScriptsVersioned("AE_AnchorPivot"); };
    btnUniqName.onClick  = function(){ runFromScriptsVersioned("AE_UniqName"); };
    btnRectGen.onClick  = function(){ runFromScriptsVersioned("AE_RectGen"); };


// よく使うフォルダツールを初期選択
    tabs.selection = tabTools;

    if (win instanceof Window) { win.center(); win.show(); }
    return win;
  }


    var win = buildUI(thisObj);

  // PanelでもWindowでも、UIを確実に描画させる
  if (win) {
    try {
      win.layout.layout(true);
      win.layout.resize();
      win.onResizing = win.onResize = function () { this.layout.resize(); };
    } catch (e) {}
  }

})(this);