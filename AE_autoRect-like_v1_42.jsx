/*==============================================================================
    オート矩形ツール（テキスト追従）修正版
    v1.1.2

    修正履歴:
      v1.1.2: アンカー指定を廃止し、余白後サイズを左右/上下方向に割合縮小できるスライダーを追加。回転対応ボックスを削除。
      v1.1.1: コーナーブラケット機能を復活し、アンカー追従とオプションUIを整理。
      v1.1.0: 9ポイントアンカー、％余白を追加。コーナーブラケット機能は削除。
      v1.0.4: 「余白固定(新)」実行時、長方形パスの検索処理(getRectProps)の
              バグを修正。これによりエクスプレッションが正しく更新されるよう対応。
      v1.0.3: visitPropsWithExpressionを使わず直接プロパティを取得する方式へ変更。
      v1.0.2: 親子付けモード時の位置リセット対応。
==============================================================================*/
(function (thisObj) {
    var SCRIPT_NAME = "オート矩形ツール";
    var MATTE_TYPE  = TrackMatteType.ALPHA;
    var PRESET_FILE = "AE_autoRect-like_presets.json";
    var GLOBAL_UI_KEY = "__AE_autoRect_like_v1_42_UI__";
    var DEFAULT_UI = {
        padX: 16,
        padY: 8,
        corner: 0,
        padUnit: "px",
        includeExt: true,
        strokeOn: true,
        strokeW: 4,
        fillOn: true,
        strokeColor: [0.2, 0.6, 1.0],
        fillColor: [0.0, 0.4, 0.9],
        shapeLabel: 9,
        bracketOn: false,
        bracketLen: 24,
        bracketStyle: 0,
        bracketLT: true,
        bracketRT: true,
        bracketLB: true,
        bracketRB: true,
        bracketStrokeW: 4,
        bracketStrokeColor: [0.2, 0.6, 1.0],
        sideLineOn: false,
        sideLineTop: true,
        sideLineBottom: true,
        sideLineLeft: true,
        sideLineRight: true,
        sideLineStrokeW: 4,
        sideLineStrokeColor: [0.2, 0.6, 1.0],
        multiMode: "each",
        insertAbove: false,
        makeAdj: false,
        setMatte: false,
        allowAuto: true
    };

    // -----------------------------
    // ユーティリティ
    // -----------------------------
    function num(v, def) {
        var n = parseFloat(v);
        return (isFinite(n)) ? n : def;
    }
    function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

    function uniqueNameInComp(comp, base) {
        var name = base, i = 2, exists = true;
        while (exists) {
            exists = false;
            for (var li = 1; li <= comp.numLayers; li++) {
                if (comp.layer(li).name === name) { exists = true; break; }
            }
            if (exists) name = base + " (" + (i++) + ")";
        }
        return name;
    }

    // トラックマットを設定できるレイヤーかどうかを判定するヘルパー
    function isTrackMatteCapableLayer(layer) {
        if (!layer) return false;
        try {
            // 新UI: setTrackMatte を持っているか
            if (typeof layer.setTrackMatte === "function") return true;

            // 旧UI: trackMatteType や trackMatteLayer を持っているか
            if ("trackMatteType" in layer) return true;
            if ("trackMatteLayer" in layer) return true;

            return false;
        } catch (e) {
            return false;
        }
    }




    function confirmOverwriteMatte(tgt){
        // ★ AVLayer 判定を isTrackMatteCapableLayer に変更
        var hasMatte = isTrackMatteCapableLayer(tgt) &&
                    (tgt.trackMatteType !== TrackMatteType.NO_TRACK_MATTE);

        if (!hasMatte) return true;
        return confirm("対象レイヤーには既にトラックマットが設定されています。\n上書きしてよろしいですか？");
    }


    function applyAlphaTrackMatte(target, matteLayer, insertAbove) {
        // トラックマットを設定できないレイヤーなら何もしない
        if (!isTrackMatteCapableLayer(target)) return;

        // トラックマットは 2D レイヤーのみ有効
        if (target.threeDLayer) target.threeDLayer = false;
        if (matteLayer.threeDLayer) matteLayer.threeDLayer = false;
        matteLayer.adjustmentLayer = false; // マット用に調整レイヤー化は無効

        // 「レイヤー参照型のトラックマット」が使えるかどうか
        var canUseLayerRefMatte = false;
        try {
            if (typeof target.setTrackMatte === "function") {
                canUseLayerRefMatte = true;
            } else if ("trackMatteLayer" in target) {
                canUseLayerRefMatte = true;
            }
        } catch (e) {}

        // ---- レイヤー位置の扱い ----
        // ・旧UI（レイヤー参照なし）の場合 → 常に target の直上に移動しないとマットにできない
        // ・新UI（setTrackMatte / trackMatteLayer有り）の場合 →
        //     「上に挿入」がON（insertAbove=true）の時だけ上に移動
        //     それ以外は元の位置のままにする
        if (!canUseLayerRefMatte) {
            // 古いトラックマット仕様: 必ず直上へ
            matteLayer.moveBefore(target);
        } else if (insertAbove) {
            // 新UIでも「上に挿入」指定があるときだけ直上へ
            matteLayer.moveBefore(target);
        }
        // insertAbove が false で新UIの場合は位置をいじらない

        // ---- トラックマットの設定 ----
        try {
            if (typeof target.setTrackMatte === "function") {
                // 新UI: レイヤー参照トラックマット
                target.setTrackMatte(matteLayer, MATTE_TYPE);
            } else if ("trackMatteLayer" in target) {
                // レイヤー指定できる旧型
                target.trackMatteLayer = matteLayer;
                target.trackMatteType  = MATTE_TYPE;
            } else {
                // 最後の保険（古い完全旧UIの場合）
                target.trackMatteType = MATTE_TYPE;
            }
        } catch (e2) {}

        // ---- マット側の表示をONに戻す ----
        // AE側の挙動でビデオスイッチが勝手にOFFになる場合があるので
        try {
            if (!matteLayer.enabled) {
                matteLayer.enabled = true;
            }
        } catch (e3) {}
    }



    function getKeyboardShift() {
        try { return ScriptUI.environment.keyboardState.shiftKey; } catch(e){ return false; }
    }

    function pickColorRGB(defaultRGB01) {
        try {
            var s = $.colorPicker(); // 0xRRGGBB or -1
            if (s < 0) return null;
            var r = ((s >> 16) & 255) / 255,
                g = ((s >> 8) & 255) / 255,
                b = (s & 255) / 255;
            return [r,g,b];
        } catch(e){ return null; }
    }

    function createColorSwatch(parent, label, initialRGB, tipText) {
        var grp = parent.add("group");
        grp.orientation = "row";
        grp.add("statictext", undefined, label);
        var sw = grp.add("button", undefined, "");
        sw.preferredSize = [40, 20];
        if (tipText) sw.helpTip = tipText;
        var color = initialRGB || [0.5,0.5,0.5];

        function redraw(){
            try {
                var g = sw.graphics;
                var b = g.newBrush(g.BrushType.SOLID_COLOR, color);
                g.newPath();
                g.rectPath(0,0,sw.size[0], sw.size[1]);
                g.fillPath(b);
            } catch(e){}
        }

        sw.onDraw = redraw;
        sw.onClick = function(){
            var c = pickColorRGB(color);
            if (c) { color = c; redraw(); }
        };

        return {
            getColor: function(){ return color; },
            setColor: function(c){ if (c) { color = c; redraw(); } }
        };
    }

    function _jsonStringify(obj) {
        try {
            if (typeof JSON !== "undefined" && JSON && JSON.stringify) {
                return JSON.stringify(obj, null, 2);
            }
        } catch (e) {}
        function esc(s){
            return String(s)
                .replace(/\\/g,"\\\\")
                .replace(/"/g,'\\"')
                .replace(/\r?\n/g,"\\n");
        }
        function ser(x){
            if (x === null) return "null";
            var t = typeof x;
            if (t === "string")  return '"' + esc(x) + '"';
            if (t === "number")  return isFinite(x) ? String(x) : "null";
            if (t === "boolean") return x ? "true" : "false";
            if (x instanceof Array) { var a=[]; for (var i=0;i<x.length;i++) a.push(ser(x[i])); return "["+a.join(",")+"]"; }
            if (t === "object")  { var kv=[]; for (var k in x) if (x.hasOwnProperty(k)) kv.push('"'+esc(k)+'":'+ser(x[k])); return "{"+kv.join(",")+"}"; }
            return "null";
        }
        return ser(obj);
    }

    function _jsonParse(text) {
        try { if (typeof JSON !== "undefined" && JSON && JSON.parse) return JSON.parse(text); } catch(e){}
        try { return eval("(" + text + ")"); } catch(e2){ return []; }
    }

    function getPresetFilePath() {
        try {
            var scriptFile = new File($.fileName);
            if (scriptFile && scriptFile.parent && scriptFile.parent.exists) {
                return scriptFile.parent.fullName + "/" + PRESET_FILE;
            }
        } catch (e) {}
        var basePath = (Folder.userData && Folder.userData.fsName) ? Folder.userData.fsName : Folder.userData.fullName;
        var targetDir = basePath + "/Adobe/After Effects/AutoRectLike";
        var folder = new Folder(targetDir);
        if (!folder.exists) folder.create();
        return folder.fullName + "/" + PRESET_FILE;
    }

    function loadPresets() {
        var presets = [];
        try {
            var f = new File(getPresetFilePath());
            if (f.exists && f.open("r")) {
                var content = f.read();
                f.close();
                var arr = _jsonParse(content);
                if (arr instanceof Array) presets = arr;
            }
        } catch (e) {}
        return presets;
    }

    function savePresets(presets) {
        try {
            var f = new File(getPresetFilePath());
            if (f.parent && !f.parent.exists) f.parent.create();
            if (f.open("w")) {
                f.encoding = "UTF-8";
                f.lineFeed = "Unix";
                f.write(_jsonStringify(presets || []));
                f.close();
                return true;
            }
        } catch (e) {}
        return false;
    }

    // -----------------------------
    // エクスプレッション生成
    // -----------------------------
    function buildLayerRectDataFunc(includeExtentsStr) {
        var s = "";
        s += "function layerPoint2D(T, x, y){\n";
        s += "  try { return T.toComp([x, y, 0]); }\n";
        s += "  catch(e) { return T.toComp([x, y]); }\n";
        s += "}\n";
        s += "function layerRectData(L){\n";
        s += "  var r = L.sourceRectAtTime(time,"+includeExtentsStr+");\n";
        s += "  var p1 = layerPoint2D(L, r.left, r.top);\n";
        s += "  var p2 = layerPoint2D(L, r.left + r.width, r.top + r.height);\n";
        s += "  var l = Math.min(p1[0], p2[0]);\n";
        s += "  var t = Math.min(p1[1], p2[1]);\n";
        s += "  var rgt = Math.max(p1[0], p2[0]);\n";
        s += "  var btm = Math.max(p1[1], p2[1]);\n";
        s += "  try{\n";
        s += "    var src = L.source;\n";
        s += "    if (src && src.numLayers){\n";
        s += "      l=1e9; t=1e9; rgt=-1e9; btm=-1e9;\n";
        s += "      for (var i=1;i<=src.numLayers;i++){\n";
        s += "        var sL = src.layer(i);\n";
        s += "        if (!sL || !sL.sourceRectAtTime) continue;\n";
        s += "        var rr = sL.sourceRectAtTime(time,"+includeExtentsStr+");\n";
        s += "        var q1 = L.toComp(layerPoint2D(sL, rr.left, rr.top));\n";
        s += "        var q2 = L.toComp(layerPoint2D(sL, rr.left + rr.width, rr.top + rr.height));\n";
        s += "        l = Math.min(l, q1[0], q2[0]);\n";
        s += "        t = Math.min(t, q1[1], q2[1]);\n";
        s += "        rgt = Math.max(rgt, q1[0], q2[0]);\n";
        s += "        btm = Math.max(btm, q1[1], q2[1]);\n";
        s += "      }\n";
        s += "      var l2=1e9,t2=1e9,r2=-1e9,b2=-1e9; var found=false;\n";
        s += "      var gx=6, gy=6;\n";
        s += "      for (var yi=0; yi<gy; yi++){\n";
        s += "        var cy = t + (btm - t) * (yi/(gy-1));\n";
        s += "        for (var xi=0; xi<gx; xi++){\n";
        s += "          var cx = l + (rgt - l) * (xi/(gx-1));\n";
        s += "          var rad = [Math.max(0.5,(rgt-l)/gx/2), Math.max(0.5,(btm-t)/gy/2)];\n";
        s += "          var alpha = L.sampleImage(L.fromComp([cx, cy]), rad, true, time)[3];\n";
        s += "          if (alpha > 0.001){\n";
        s += "            if (!found){ l2=cx; r2=cx; t2=cy; b2=cy; found=true; }\n";
        s += "            l2 = Math.min(l2, cx); r2 = Math.max(r2, cx); t2 = Math.min(t2, cy); b2 = Math.max(b2, cy);\n";
        s += "          }\n";
        s += "        }\n";
        s += "      }\n";
        s += "      if (found){ l=l2; t=t2; rgt=r2; btm=b2; }\n";
        s += "    }\n";
        s += "  }catch(e){}\n";
        s += "  return {l:l, t:t, r:rgt, b:btm, w:Math.max(0,rgt-l), h:Math.max(0,btm-t)};\n";
        s += "}\n";
        return s;
    }

    // mode: "parent" | "direct" | "multi"
    function buildRectSizeExpr(mode, targetNameList, includeExtents, shrinkXVal, shrinkYVal) {
        var inc = includeExtents ? "true" : "false";
        var sX = isFinite(shrinkXVal) ? shrinkXVal : 0;
        var sY = isFinite(shrinkYVal) ? shrinkYVal : 0;
        var s  = "";
        s += "function pickSlider(name, def){ var ef = effect(name); return ef ? ef('スライダー') : def; }\n";
        s += "var pxSlider = pickSlider('余白 X', 0);\n";
        s += "var pySlider = pickSlider('余白 Y', 0);\n";
        s += "var usePct = pickSlider('余白%モード', 0);\n";
        s += "var shrinkX = pickSlider('縮小 左右%', " + sX + ");\n";
        s += "var shrinkY = pickSlider('縮小 上下%', " + sY + ");\n";
        s += "function padVals(r){\n";
        s += "  var px = (usePct > 0.5) ? r.width  * (pxSlider*0.01) : pxSlider;\n";
        s += "  var py = (usePct > 0.5) ? r.height * (pySlider*0.01) : pySlider;\n";
        s += "  return [px, py];\n";
        s += "}\n";
        s += "function localRect(L){ var r = L.sourceRectAtTime(time," + inc + "); return {l:r.left, t:r.top, w:r.width, h:r.height}; }\n";
        s += "function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }\n";
        s += "function shrinkEdges(base, v){\n";
        s += "  var f = clamp(v*0.01, -1, 1);\n";
        s += "  var amt = Math.abs(f);\n";
        s += "  var start = 0, end = base;\n";
        s += "  if (f > 0){ start = base * amt; }\n";
        s += "  else if (f < 0){ end = base * (1 - amt); }\n";
        s += "  return [start, end];\n";
        s += "}\n";
        s += "function to2D(v){ return [v[0], v[1]]; }\n";
        s += buildLayerRectDataFunc(inc);

        if (mode === "parent") {
            s += "var L = parent;\n";
            s += "if (L){\n";
            s += "  var rd = localRect(L);\n";
            s += "  var p = padVals({width:rd.w, height:rd.h});\n";
            s += "  var px = p[0], py = p[1];\n";
            s += "  var w0 = Math.max(0, rd.w  + px*2);\n";
            s += "  var h0 = Math.max(0, rd.h + py*2);\n";
            s += "  var leftPad = rd.l - px;\n";
            s += "  var topPad = rd.t - py;\n";
            s += "  var ex = shrinkEdges(w0, shrinkX);\n";
            s += "  var ey = shrinkEdges(h0, -shrinkY);\n";
            s += "  var leftEdge = leftPad + ex[0];\n";
            s += "  var rightEdge = leftPad + ex[1];\n";
            s += "  var topEdge = topPad + ey[0];\n";
            s += "  var bottomEdge = topPad + ey[1];\n";
            s += "  var w1 = Math.max(0, rightEdge - leftEdge);\n";
            s += "  var h1 = Math.max(0, bottomEdge - topEdge);\n";
            s += "  [w1, h1];\n";
            s += "}else{\n";
            s += "  [0,0];\n";
            s += "}\n";

        } else if (mode === "direct") {
            s += "var L = thisComp.layer('"+ targetNameList[0].replace(/'/g,"\\'") +"');\n";
            s += "if (L){\n";
            s += "  var rd = localRect(L);\n";
            s += "  var p = padVals({width:rd.w, height:rd.h});\n";
            s += "  var px = p[0], py = p[1];\n";
            s += "  var w0 = Math.max(0, rd.w  + px*2);\n";
            s += "  var h0 = Math.max(0, rd.h + py*2);\n";
            s += "  var leftPad = rd.l - px;\n";
            s += "  var topPad = rd.t - py;\n";
            s += "  var ex = shrinkEdges(w0, shrinkX);\n";
            s += "  var ey = shrinkEdges(h0, -shrinkY);\n";
            s += "  var leftEdge = leftPad + ex[0];\n";
            s += "  var rightEdge = leftPad + ex[1];\n";
            s += "  var topEdge = topPad + ey[0];\n";
            s += "  var bottomEdge = topPad + ey[1];\n";
            s += "  var w1 = Math.max(0, rightEdge - leftEdge);\n";
            s += "  var h1 = Math.max(0, bottomEdge - topEdge);\n";
            s += "  [w1, h1];\n";
            s += "}else{\n";
            s += "  [0,0];\n";
            s += "}\n";

        } else { // multi
            s += "var names = [\n";
            for (var i=0;i<targetNameList.length;i++){
                s += "  '"+ targetNameList[i].replace(/'/g,"\\'") +"'" + (i<targetNameList.length-1 ? ",\n" : "\n");
            }
            s += "];\n";
            s += "var l=1e9,t=1e9,r=-1e9,b=-1e9;\n";
            s += "for (var i=0;i<names.length;i++){\n";
            s += "  var L = thisComp.layer(names[i]);\n";
            s += "  if(!L) continue;\n";
            s += "  if (!L.sourceRectAtTime) continue;\n";
            s += "  var rd = layerRectData(L);\n";
            s += "  l = Math.min(l, rd.l);\n";
            s += "  t = Math.min(t, rd.t);\n";
            s += "  r = Math.max(r, rd.r);\n";
            s += "  b = Math.max(b, rd.b);\n";
            s += "}\n";
            s += "var baseW = Math.max(0, r - l);\n";
            s += "var baseH = Math.max(0, b - t);\n";
            s += "var p = padVals({width:baseW, height:baseH});\n";
            s += "var px = p[0], py = p[1];\n";
            s += "var w0 = Math.max(0, baseW + px*2);\n";
            s += "var h0 = Math.max(0, baseH + py*2);\n";
            s += "var ex = shrinkEdges(w0, shrinkX);\n";
            s += "var ey = shrinkEdges(h0, -shrinkY);\n";
            s += "var w1 = Math.max(0, ex[1] - ex[0]);\n";
            s += "var h1 = Math.max(0, ey[1] - ey[0]);\n";
            s += "[w1, h1];\n";
        }
        return s;
    }


    function buildRectPosExpr(mode, targetNameList, includeExtents, shrinkXVal, shrinkYVal) {
        var inc = includeExtents ? "true" : "false";
        var sX = isFinite(shrinkXVal) ? shrinkXVal : 0;
        var sY = isFinite(shrinkYVal) ? shrinkYVal : 0;
        var s  = "";
        s += "function pickSlider(name, def){ var ef = effect(name); return ef ? ef('スライダー') : def; }\n";
        s += "var pxSlider = pickSlider('余白 X', 0);\n";
        s += "var pySlider = pickSlider('余白 Y', 0);\n";
        s += "var usePct = pickSlider('余白%モード', 0);\n";
        s += "var shrinkX = pickSlider('縮小 左右%', " + sX + ");\n";
        s += "var shrinkY = pickSlider('縮小 上下%', " + sY + ");\n";
        s += "function padVals(r){\n";
        s += "  var px = (usePct > 0.5) ? r.width  * (pxSlider*0.01) : pxSlider;\n";
        s += "  var py = (usePct > 0.5) ? r.height * (pySlider*0.01) : pySlider;\n";
        s += "  return [px, py];\n";
        s += "}\n";
        s += "function to2D(v){ return [v[0], v[1]]; }\n";
        s += "function toLayer(pt){ return to2D(fromComp(pt)); }\n";
        s += "function toCompAuto(T, pt){ try { return T.toComp([pt[0], pt[1], 0]); } catch(e){ return T.toComp([pt[0], pt[1]]); } }\n";
        s += "function localRect(L){ var r = L.sourceRectAtTime(time," + inc + "); return {l:r.left, t:r.top, w:r.width, h:r.height}; }\n";
        s += "function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }\n";
        s += "function shrinkEdges(base, v){\n";
        s += "  var f = clamp(v*0.01, -1, 1);\n";
        s += "  var amt = Math.abs(f);\n";
        s += "  var start = 0, end = base;\n";
        s += "  if (f > 0){ start = base * amt; }\n";
        s += "  else if (f < 0){ end = base * (1 - amt); }\n";
        s += "  return [start, end];\n";
        s += "}\n";
        s += buildLayerRectDataFunc(inc);

        if (mode === "parent") {
            s += "var L = parent;\n";
            s += "if (L){\n";
            s += "  var rd = localRect(L);\n";
            s += "  var p = padVals({width:rd.w, height:rd.h});\n";
            s += "  var px = p[0], py = p[1];\n";
            s += "  var baseW = Math.max(0, rd.w + px*2);\n";
            s += "  var baseH = Math.max(0, rd.h + py*2);\n";
            s += "  var leftPad = rd.l - px;\n";
            s += "  var topPad  = rd.t - py;\n";
            s += "  var ex = shrinkEdges(baseW, shrinkX);\n";
            s += "  var ey = shrinkEdges(baseH, -shrinkY);\n";
            s += "  var leftEdge = leftPad + ex[0];\n";
            s += "  var rightEdge = leftPad + ex[1];\n";
            s += "  var topEdge = topPad + ey[0];\n";
            s += "  var bottomEdge = topPad + ey[1];\n";
            s += "  var cx = (leftEdge + rightEdge) / 2;\n";
            s += "  var cy = (topEdge + bottomEdge) / 2;\n";
            s += "  to2D(fromComp(toCompAuto(L, [cx, cy])));\n";
            s += "}else{\n";
            s += "  [0,0];\n";
            s += "}\n";

        } else if (mode === "direct") {
            s += "var L = thisComp.layer('"+ targetNameList[0].replace(/'/g,"\\'") +"');\n";
            s += "if (L){\n";
            s += "  var rd = localRect(L);\n";
            s += "  var p = padVals({width:rd.w, height:rd.h});\n";
            s += "  var px = p[0], py = p[1];\n";
            s += "  var baseW = Math.max(0, rd.w + px*2);\n";
            s += "  var baseH = Math.max(0, rd.h + py*2);\n";
            s += "  var leftPad = rd.l - px;\n";
            s += "  var topPad  = rd.t - py;\n";
            s += "  var ex = shrinkEdges(baseW, shrinkX);\n";
            s += "  var ey = shrinkEdges(baseH, -shrinkY);\n";
            s += "  var leftEdge = leftPad + ex[0];\n";
            s += "  var rightEdge = leftPad + ex[1];\n";
            s += "  var topEdge = topPad + ey[0];\n";
            s += "  var bottomEdge = topPad + ey[1];\n";
            s += "  var cx = (leftEdge + rightEdge) / 2;\n";
            s += "  var cy = (topEdge + bottomEdge) / 2;\n";
            s += "  to2D(fromComp(toCompAuto(L, [cx, cy])));\n";
            s += "}else{\n";
            s += "  [0,0];\n";
            s += "}\n";

        } else { // multi
            s += "var names = [\n";
            for (var i=0;i<targetNameList.length;i++){
                s += "  '"+ targetNameList[i].replace(/'/g,"\\'") +"'" + (i<targetNameList.length-1 ? ",\n" : "\n");
            }
            s += "];\n";
            s += "function rectOf(L){\n";
            s += "  var rd = layerRectData(L);\n";
            s += "  return [rd.l, rd.t, rd.r, rd.b];\n";
            s += "}\n";
            s += "var l=1e9,t=1e9,r=-1e9,b=-1e9;\n";
            s += "for (var i=0;i<names.length;i++){\n";
            s += "  var L=thisComp.layer(names[i]);\n";
            s += "  if(!L) continue;\n";
            s += "  if(!L.sourceRectAtTime) continue;\n";
            s += "  var rc=rectOf(L);\n";
            s += "  l=Math.min(l,rc[0]);\n";
            s += "  t=Math.min(t,rc[1]);\n";
            s += "  r=Math.max(r,rc[2]);\n";
            s += "  b=Math.max(b,rc[3]);\n";
            s += "}\n";
            s += "var baseW = Math.max(0, r - l);\n";
            s += "var baseH = Math.max(0, b - t);\n";
            s += "var p = padVals({width:baseW, height:baseH});\n";
            s += "var px = p[0], py = p[1];\n";
            s += "var w0 = Math.max(0, baseW + px*2);\n";
            s += "var h0 = Math.max(0, baseH + py*2);\n";
            s += "var leftPad = l - px;\n";
            s += "var topPad  = t - py;\n";
            s += "var ex = shrinkEdges(w0, shrinkX);\n";
            s += "var ey = shrinkEdges(h0, -shrinkY);\n";
            s += "var leftEdge = leftPad + ex[0];\n";
            s += "var rightEdge = leftPad + ex[1];\n";
            s += "var topEdge = topPad + ey[0];\n";
            s += "var bottomEdge = topPad + ey[1];\n";
            s += "var cx = (leftEdge + rightEdge) / 2;\n";
            s += "var cy = (topEdge + bottomEdge) / 2;\n";
            s += "toLayer([cx, cy]);\n";
        }
        return s;
    }


    function buildBracketPathExpr(cornerLabel, dirX, dirY) {
        var s = "";
        s += "function pick(name, def){ var ef = effect(name); if(!ef) return def; var p=ef(1); return (p && isFinite(p.value)) ? p.value : def; }\n";
        s += "var enabled = pick('コーナーブラケット', 0);\n";
        s += "var cornerEnabled = pick('ブラケット " + cornerLabel + "', 0);\n";
        s += "var path;\n";
        s += "if (enabled < 0.5 || cornerEnabled < 0.5){\n";
        s += "  path = createPath([[0,0],[0,0],[0,0]], [[0,0],[0,0],[0,0]], [[0,0],[0,0],[0,0]], false);\n";
        s += "} else {\n";
        s += "  var len = pick('ブラケット長', 0);\n";
        s += "  var style = pick('ブラケットスタイル', 0);\n";
        s += "  var sign = (style >= 0.5) ? -1 : 1;\n";
        s += "  var dx = " + dirX + " * sign * len;\n";
        s += "  var dy = " + dirY + " * sign * len;\n";
        // コーナー(0,0)を曲がり点にし、縦→曲がり→横の順で描画
        s += "  path = createPath([[0,dy],[0,0],[dx,0]], [[0,0],[0,0],[0,0]], [[0,0],[0,0],[0,0]], false);\n";
        s += "}\n";
        s += "path;\n";
        return s;
    }

    function buildSideLinePathExpr(mode, targetNameList, includeExtents, sideLabel, orientation, shrinkXVal, shrinkYVal) {
        var inc = includeExtents ? "true" : "false";
        var sX = isFinite(shrinkXVal) ? shrinkXVal : 0;
        var sY = isFinite(shrinkYVal) ? shrinkYVal : 0;
        var s = "";
        s += "function pick(name, def){ var ef = effect(name); if(!ef) return def; var p=ef(1); return (p && isFinite(p.value)) ? p.value : def; }\n";
        s += "var enabled = pick('サイドライン', 0);\n";
        s += "var sideEnabled = pick('サイドライン " + sideLabel + "', 0);\n";
        s += "var path;\n";
        s += "if (enabled < 0.5 || sideEnabled < 0.5){\n";
        s += "  path = createPath([[0,0],[0,0]], [[0,0],[0,0]], [[0,0],[0,0]], false);\n";
        s += "} else {\n";
        s += "  var shrink = pick('サイドライン " + sideLabel + " 縮小%', 0);\n";
        s += "  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }\n";
        s += "  function spanFrom(base, v){\n";
        s += "    var f = clamp(v*0.01, -1, 1);\n";
        s += "    var amt = Math.abs(f);\n";
        s += "    var start = 0, end = base;\n";
        s += "    if (f > 0){ start = base * amt; }\n";
        s += "    else if (f < 0){ end = base * (1 - amt); }\n";
        s += "    return [start, end];\n";
        s += "  }\n";
        s += "  function pickSlider(name, def){ var ef = effect(name); return ef ? ef('スライダー') : def; }\n";
        s += "  var pxSlider = pickSlider('余白 X', 0);\n";
        s += "  var pySlider = pickSlider('余白 Y', 0);\n";
        s += "  var usePct = pickSlider('余白%モード', 0);\n";
        s += "  var shrinkX = pickSlider('縮小 左右%', " + sX + ");\n";
        s += "  var shrinkY = pickSlider('縮小 上下%', " + sY + ");\n";
        s += "  function padVals(r){\n";
        s += "    var px = (usePct > 0.5) ? r.width  * (pxSlider*0.01) : pxSlider;\n";
        s += "    var py = (usePct > 0.5) ? r.height * (pySlider*0.01) : pySlider;\n";
        s += "    return [px, py];\n";
        s += "  }\n";
        s += "  function localRect(L){ var r = L.sourceRectAtTime(time," + inc + "); return {l:r.left, t:r.top, w:r.width, h:r.height}; }\n";
        s += "  function shrinkEdges(base, v){\n";
        s += "    var f = clamp(v*0.01, -1, 1);\n";
        s += "    var amt = Math.abs(f);\n";
        s += "    var start = 0, end = base;\n";
        s += "    if (f > 0){ start = base * amt; }\n";
        s += "    else if (f < 0){ end = base * (1 - amt); }\n";
        s += "    return [start, end];\n";
        s += "  }\n";
        s += buildLayerRectDataFunc(inc);
        s += "  var baseLen = 0;\n";
        s += "  var mode = '" + mode + "';\n";
        s += "  if (mode === 'parent') {\n";
        s += "    var L = parent;\n";
        s += "    if (L){\n";
        s += "      var rd = localRect(L);\n";
        s += "      var p = padVals({width:rd.w, height:rd.h});\n";
        s += "      var px = p[0], py = p[1];\n";
        s += "      var baseW = Math.max(0, rd.w + px*2);\n";
        s += "      var baseH = Math.max(0, rd.h + py*2);\n";
        s += "      var ex = shrinkEdges(baseW, shrinkX);\n";
        s += "      var ey = shrinkEdges(baseH, -shrinkY);\n";
        s += "      var w = Math.max(0, ex[1] - ex[0]);\n";
        s += "      var h = Math.max(0, ey[1] - ey[0]);\n";
        s += "      baseLen = " + (orientation === "h" ? "w" : "h") + ";\n";
        s += "    }\n";
        s += "  } else if (mode === 'direct') {\n";
        s += "    var L = thisComp.layer('"+ targetNameList[0].replace(/'/g,"\\'") +"');\n";
        s += "    if (L){\n";
        s += "      var rd = localRect(L);\n";
        s += "      var p = padVals({width:rd.w, height:rd.h});\n";
        s += "      var px = p[0], py = p[1];\n";
        s += "      var baseW = Math.max(0, rd.w + px*2);\n";
        s += "      var baseH = Math.max(0, rd.h + py*2);\n";
        s += "      var ex = shrinkEdges(baseW, shrinkX);\n";
        s += "      var ey = shrinkEdges(baseH, -shrinkY);\n";
        s += "      var w = Math.max(0, ex[1] - ex[0]);\n";
        s += "      var h = Math.max(0, ey[1] - ey[0]);\n";
        s += "      baseLen = " + (orientation === "h" ? "w" : "h") + ";\n";
        s += "    }\n";
        s += "  } else {\n";
        s += "    var names = [\n";
        for (var i=0;i<targetNameList.length;i++){
            s += "      '"+ targetNameList[i].replace(/'/g,"\\'") +"'" + (i<targetNameList.length-1 ? ",\n" : "\n");
        }
        s += "    ];\n";
        s += "    var l=1e9,t=1e9,r=-1e9,b=-1e9;\n";
        s += "    for (var i=0;i<names.length;i++){\n";
        s += "      var L = thisComp.layer(names[i]);\n";
        s += "      if(!L) continue;\n";
        s += "      if (!L.sourceRectAtTime) continue;\n";
        s += "      var rd = layerRectData(L);\n";
        s += "      l = Math.min(l, rd.l);\n";
        s += "      t = Math.min(t, rd.t);\n";
        s += "      r = Math.max(r, rd.r);\n";
        s += "      b = Math.max(b, rd.b);\n";
        s += "    }\n";
        s += "    var baseW = Math.max(0, r - l);\n";
        s += "    var baseH = Math.max(0, b - t);\n";
        s += "    var p = padVals({width:baseW, height:baseH});\n";
        s += "    var px = p[0], py = p[1];\n";
        s += "    var w0 = Math.max(0, baseW + px*2);\n";
        s += "    var h0 = Math.max(0, baseH + py*2);\n";
        s += "    var ex = shrinkEdges(w0, shrinkX);\n";
        s += "    var ey = shrinkEdges(h0, -shrinkY);\n";
        s += "    var w = Math.max(0, ex[1] - ex[0]);\n";
        s += "    var h = Math.max(0, ey[1] - ey[0]);\n";
        s += "    baseLen = " + (orientation === "h" ? "w" : "h") + ";\n";
        s += "  }\n";
        s += "  var shrinkVal = " + (orientation === "h" ? "shrink" : "-shrink") + ";\n";
        s += "  var span = spanFrom(baseLen, shrinkVal);\n";
        if (orientation === "h") {
            s += "  path = createPath([[span[0],0],[span[1],0]], [[0,0],[0,0]], [[0,0],[0,0]], false);\n";
        } else {
            s += "  path = createPath([[0,span[0]],[0,span[1]]], [[0,0],[0,0]], [[0,0],[0,0]], false);\n";
        }
        s += "}\n";
        s += "path;\n";
        return s;
    }

function buildBracketPosExpr(mode, targetNameList, includeExtents, cornerX, cornerY, shrinkXVal, shrinkYVal) {
        var inc = includeExtents ? "true" : "false";
        var sX = isFinite(shrinkXVal) ? shrinkXVal : 0;
        var sY = isFinite(shrinkYVal) ? shrinkYVal : 0;
        var s  = "";
        s += "function pickSlider(name, def){ var ef = effect(name); if(!ef) return def; var sld = ef('スライダー'); return (sld && isFinite(sld.value)) ? sld.value : def; }\n";
        s += "var pxSlider = pickSlider('余白 X', 0);\n";
        s += "var pySlider = pickSlider('余白 Y', 0);\n";
        s += "var usePct = pickSlider('余白%モード', 0);\n";
        s += "var shrinkX = pickSlider('縮小 左右%', " + sX + ");\n";
        s += "var shrinkY = pickSlider('縮小 上下%', " + sY + ");\n";
        s += "function padVals(r){\n";
        s += "  var px = (usePct > 0.5) ? r.width  * (pxSlider*0.01) : pxSlider;\n";
        s += "  var py = (usePct > 0.5) ? r.height * (pySlider*0.01) : pySlider;\n";
        s += "  return [px, py];\n";
        s += "}\n";
        s += "function to2D(v){ return [v[0], v[1]]; }\n";
        s += "function toLayer(pt){ return to2D(fromComp(pt)); }\n";
        s += "function toCompAuto(T, pt){ try { return T.toComp([pt[0], pt[1], 0]); } catch(e){ return T.toComp([pt[0], pt[1]]); } }\n";
        s += "function localRect(L){ var r = L.sourceRectAtTime(time," + inc + "); return {l:r.left, t:r.top, w:r.width, h:r.height}; }\n";
        s += "function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }\n";
        s += "function shrinkEdges(base, v){\n";
        s += "  var f = clamp(v*0.01, -1, 1);\n";
        s += "  var amt = Math.abs(f);\n";
        s += "  var start = 0, end = base;\n";
        s += "  if (f > 0){ start = base * amt; }\n";
        s += "  else if (f < 0){ end = base * (1 - amt); }\n";
        s += "  return [start, end];\n";
        s += "}\n";
        s += buildLayerRectDataFunc(inc);
        s += "var mode = '" + mode + "';\n";
        s += "if (mode === 'parent') {\n";
        s += "  var L = parent;\n";
        s += "  if (L){\n";
        s += "    var rd = localRect(L);\n";
        s += "    var p = padVals({width:rd.w, height:rd.h});\n";
        s += "    var px = p[0], py = p[1];\n";
        s += "    var baseW = Math.max(0, rd.w + px*2);\n";
        s += "    var baseH = Math.max(0, rd.h + py*2);\n";
        s += "    var leftPad = rd.l - px;\n";
        s += "    var topPad  = rd.t - py;\n";
        s += "    var ex = shrinkEdges(baseW, shrinkX);\n";
        s += "    var ey = shrinkEdges(baseH, -shrinkY);\n";
        s += "    var leftEdge = leftPad + ex[0];\n";
        s += "    var rightEdge = leftPad + ex[1];\n";
        s += "    var topEdge = topPad + ey[0];\n";
        s += "    var bottomEdge = topPad + ey[1];\n";
        s += "    var w = Math.max(0, rightEdge - leftEdge);\n";
        s += "    var h = Math.max(0, bottomEdge - topEdge);\n";
        s += "    var cornerLayer = [leftEdge + w*(" + cornerX + "), topEdge + h*(" + cornerY + ")];\n";
        s += "    to2D(fromComp(toCompAuto(L, cornerLayer)));\n";
        s += "  } else {\n";
        s += "    [0,0];\n";
        s += "  }\n";
        s += "} else if (mode === 'direct') {\n";
        s += "  var L = thisComp.layer('"+ targetNameList[0].replace(/'/g,"\\'") +"');\n";
        s += "  if (L){\n";
        s += "    var rd = localRect(L);\n";
        s += "    var p = padVals({width:rd.w, height:rd.h});\n";
        s += "    var px = p[0], py = p[1];\n";
        s += "    var baseW = Math.max(0, rd.w + px*2);\n";
        s += "    var baseH = Math.max(0, rd.h + py*2);\n";
        s += "    var leftPad = rd.l - px;\n";
        s += "    var topPad  = rd.t - py;\n";
        s += "    var ex = shrinkEdges(baseW, shrinkX);\n";
        s += "    var ey = shrinkEdges(baseH, -shrinkY);\n";
        s += "    var leftEdge = leftPad + ex[0];\n";
        s += "    var rightEdge = leftPad + ex[1];\n";
        s += "    var topEdge = topPad + ey[0];\n";
        s += "    var bottomEdge = topPad + ey[1];\n";
        s += "    var w = Math.max(0, rightEdge - leftEdge);\n";
        s += "    var h = Math.max(0, bottomEdge - topEdge);\n";
        s += "    var cornerLayer = [leftEdge + w*(" + cornerX + "), topEdge + h*(" + cornerY + ")];\n";
        s += "    to2D(fromComp(toCompAuto(L, cornerLayer)));\n";
        s += "  } else {\n";
        s += "    [0,0];\n";
        s += "  }\n";
        s += "} else {\n";
        s += "  var names = [\n";
        for (var i=0;i<targetNameList.length;i++){
            s += "    '"+ targetNameList[i].replace(/'/g,"\\'") +"'" + (i<targetNameList.length-1 ? ",\n" : "\n");
        }
        s += "  ];\n";
        s += "  function rectOf(L){ var rd = layerRectData(L); return [rd.l, rd.t, rd.r, rd.b]; }\n";
        s += "  var l=1e9,t=1e9,r=-1e9,b=-1e9;\n";
        s += "  for (var i=0;i<names.length;i++){\n";
        s += "    var L=thisComp.layer(names[i]);\n";
        s += "    if(!L) continue;\n";
        s += "    if(!L.sourceRectAtTime) continue;\n";
        s += "    var rc=rectOf(L);\n";
        s += "    l=Math.min(l,rc[0]);\n";
        s += "    t=Math.min(t,rc[1]);\n";
        s += "    r=Math.max(r,rc[2]);\n";
        s += "    b=Math.max(b,rc[3]);\n";
        s += "  }\n";
        s += "  var baseW = Math.max(0, r - l);\n";
        s += "  var baseH = Math.max(0, b - t);\n";
        s += "  var p = padVals({width:baseW, height:baseH});\n";
        s += "  var px = p[0], py = p[1];\n";
        s += "  var w0 = Math.max(0, baseW + px*2);\n";
        s += "  var h0 = Math.max(0, baseH + py*2);\n";
        s += "  var leftPad = l - px;\n";
        s += "  var topPad  = t - py;\n";
        s += "  var ex = shrinkEdges(w0, shrinkX);\n";
        s += "  var ey = shrinkEdges(h0, -shrinkY);\n";
        s += "  var leftEdge = leftPad + ex[0];\n";
        s += "  var rightEdge = leftPad + ex[1];\n";
        s += "  var topEdge = topPad + ey[0];\n";
        s += "  var bottomEdge = topPad + ey[1];\n";
        s += "  var w = Math.max(0, rightEdge - leftEdge);\n";
        s += "  var h = Math.max(0, bottomEdge - topEdge);\n";
        s += "  var corner = [leftEdge + w*(" + cornerX + "), topEdge + h*(" + cornerY + ")];\n";
        s += "  toLayer(corner);\n";
        s += "}\n";
        return s;
    }


    function buildSideLinePosExpr(mode, targetNameList, includeExtents, sideLabel, shrinkXVal, shrinkYVal) {
        var inc = includeExtents ? "true" : "false";
        var sX = isFinite(shrinkXVal) ? shrinkXVal : 0;
        var sY = isFinite(shrinkYVal) ? shrinkYVal : 0;
        var s  = "";
        var sidePoint = (function(label){
            if (label === "bottom") return "[leftEdge, bottomEdge]";
            if (label === "right") return "[rightEdge, topEdge]";
            return "[leftEdge, topEdge]";
        })(sideLabel);
        s += "function pickSlider(name, def){ var ef = effect(name); if(!ef) return def; var sld = ef('スライダー'); return (sld && isFinite(sld.value)) ? sld.value : def; }\n";
        s += "var pxSlider = pickSlider('余白 X', 0);\n";
        s += "var pySlider = pickSlider('余白 Y', 0);\n";
        s += "var usePct = pickSlider('余白%モード', 0);\n";
        s += "var shrinkX = pickSlider('縮小 左右%', " + sX + ");\n";
        s += "var shrinkY = pickSlider('縮小 上下%', " + sY + ");\n";
        s += "function padVals(r){\n";
        s += "  var px = (usePct > 0.5) ? r.width  * (pxSlider*0.01) : pxSlider;\n";
        s += "  var py = (usePct > 0.5) ? r.height * (pySlider*0.01) : pySlider;\n";
        s += "  return [px, py];\n";
        s += "}\n";
        s += "function to2D(v){ return [v[0], v[1]]; }\n";
        s += "function toLayer(pt){ return to2D(fromComp(pt)); }\n";
        s += "function toCompAuto(T, pt){ try { return T.toComp([pt[0], pt[1], 0]); } catch(e){ return T.toComp([pt[0], pt[1]]); } }\n";
        s += "function localRect(L){ var r = L.sourceRectAtTime(time," + inc + "); return {l:r.left, t:r.top, w:r.width, h:r.height}; }\n";
        s += "function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }\n";
        s += "function shrinkEdges(base, v){\n";
        s += "  var f = clamp(v*0.01, -1, 1);\n";
        s += "  var amt = Math.abs(f);\n";
        s += "  var start = 0, end = base;\n";
        s += "  if (f > 0){ start = base * amt; }\n";
        s += "  else if (f < 0){ end = base * (1 - amt); }\n";
        s += "  return [start, end];\n";
        s += "}\n";
        s += buildLayerRectDataFunc(inc);
        s += "var mode = '" + mode + "';\n";
        s += "if (mode === 'parent') {\n";
        s += "  var L = parent;\n";
        s += "  if (L){\n";
        s += "    var rd = localRect(L);\n";
        s += "    var p = padVals({width:rd.w, height:rd.h});\n";
        s += "    var px = p[0], py = p[1];\n";
        s += "    var baseW = Math.max(0, rd.w + px*2);\n";
        s += "    var baseH = Math.max(0, rd.h + py*2);\n";
        s += "    var leftPad = rd.l - px;\n";
        s += "    var topPad  = rd.t - py;\n";
        s += "    var ex = shrinkEdges(baseW, shrinkX);\n";
        s += "    var ey = shrinkEdges(baseH, -shrinkY);\n";
        s += "    var leftEdge = leftPad + ex[0];\n";
        s += "    var rightEdge = leftPad + ex[1];\n";
        s += "    var topEdge = topPad + ey[0];\n";
        s += "    var bottomEdge = topPad + ey[1];\n";
        s += "    to2D(fromComp(toCompAuto(L, " + sidePoint + ")));\n";
        s += "  } else {\n";
        s += "    [0,0];\n";
        s += "  }\n";
        s += "} else if (mode === 'direct') {\n";
        s += "  var L = thisComp.layer('"+ targetNameList[0].replace(/'/g,"\\'") +"');\n";
        s += "  if (L){\n";
        s += "    var rd = localRect(L);\n";
        s += "    var p = padVals({width:rd.w, height:rd.h});\n";
        s += "    var px = p[0], py = p[1];\n";
        s += "    var baseW = Math.max(0, rd.w + px*2);\n";
        s += "    var baseH = Math.max(0, rd.h + py*2);\n";
        s += "    var leftPad = rd.l - px;\n";
        s += "    var topPad  = rd.t - py;\n";
        s += "    var ex = shrinkEdges(baseW, shrinkX);\n";
        s += "    var ey = shrinkEdges(baseH, -shrinkY);\n";
        s += "    var leftEdge = leftPad + ex[0];\n";
        s += "    var rightEdge = leftPad + ex[1];\n";
        s += "    var topEdge = topPad + ey[0];\n";
        s += "    var bottomEdge = topPad + ey[1];\n";
        s += "    to2D(fromComp(toCompAuto(L, " + sidePoint + ")));\n";
        s += "  } else {\n";
        s += "    [0,0];\n";
        s += "  }\n";
        s += "} else {\n";
        s += "  var names = [\n";
        for (var i=0;i<targetNameList.length;i++){
            s += "    '"+ targetNameList[i].replace(/'/g,"\\'") +"'" + (i<targetNameList.length-1 ? ",\n" : "\n");
        }
        s += "  ];\n";
        s += "  function rectOf(L){ var rd = layerRectData(L); return [rd.l, rd.t, rd.r, rd.b]; }\n";
        s += "  var l=1e9,t=1e9,r=-1e9,b=-1e9;\n";
        s += "  for (var i=0;i<names.length;i++){\n";
        s += "    var L=thisComp.layer(names[i]);\n";
        s += "    if(!L) continue;\n";
        s += "    if(!L.sourceRectAtTime) continue;\n";
        s += "    var rc=rectOf(L);\n";
        s += "    l=Math.min(l,rc[0]);\n";
        s += "    t=Math.min(t,rc[1]);\n";
        s += "    r=Math.max(r,rc[2]);\n";
        s += "    b=Math.max(b,rc[3]);\n";
        s += "  }\n";
        s += "  var baseW = Math.max(0, r - l);\n";
        s += "  var baseH = Math.max(0, b - t);\n";
        s += "  var p = padVals({width:baseW, height:baseH});\n";
        s += "  var px = p[0], py = p[1];\n";
        s += "  var w0 = Math.max(0, baseW + px*2);\n";
        s += "  var h0 = Math.max(0, baseH + py*2);\n";
        s += "  var leftPad = l - px;\n";
        s += "  var topPad  = t - py;\n";
        s += "  var ex = shrinkEdges(w0, shrinkX);\n";
        s += "  var ey = shrinkEdges(h0, -shrinkY);\n";
        s += "  var leftEdge = leftPad + ex[0];\n";
        s += "  var rightEdge = leftPad + ex[1];\n";
        s += "  var topEdge = topPad + ey[0];\n";
        s += "  var bottomEdge = topPad + ey[1];\n";
        s += "  toLayer(" + sidePoint + ");\n";
        s += "}\n";
        return s;
    }


    function buildRoundnessExpr() {
        return "var v = effect('角丸')('スライダー');\n" +
               "Math.max(0, Math.min(100, v));";
    }


    function matchParentTransform(dstLayer, srcLayer) {
        if (!dstLayer || !srcLayer) return;
        try {
            if (srcLayer.parent) {
                dstLayer.parent = srcLayer.parent;
            }
        } catch (e) {}
    }

    function linkLayerTransformByExpr(dstLayer, srcLayer) {
        // 親子付けオフ時の追従用
        var dT = dstLayer.transform,
            sT = srcLayer.transform;

        var props = ["アンカーポイント","位置","スケール","回転"];

        if (srcLayer.threeDLayer) {
            if (!dstLayer.threeDLayer) dstLayer.threeDLayer = true;
            props = ["アンカーポイント","位置","スケール","X 回転","Y 回転","Z 回転","方向"];
        }

        for (var i=0;i<props.length;i++){
            var p = dT.property(props[i]);
            if (!p) continue;
            var expr = "thisComp.layer('"+ srcLayer.name.replace(/'/g,"\\'") +
                       "').transform('"+ props[i] +"')";
            p.expression = expr;
        }
    }

    // -----------------------------
    // シェイプ作成まわり
    // -----------------------------
    function ensureStrokeFill(group, opt) {
        var g = group.property("Contents");
        var stroke = null, fill = null;

        // 先にフィルを追加し、最後に線を追加することで、線が最前面に表示されるようにする
        if (opt.fillOn) {
            fill = g.addProperty("ADBE Vector Graphic - Fill");
            if (opt.fillColor) fill.property("ADBE Vector Fill Color").setValue(opt.fillColor);
        }
        if (opt.strokeOn) {
            stroke = g.addProperty("ADBE Vector Graphic - Stroke");
            var widthProp = stroke.property("ADBE Vector Stroke Width");
            if (widthProp.canSetExpression) {
                widthProp.expression = "var base = " + (opt.strokeWidth || 0) + ";\n" +
                                       "var adj = effect('線幅 調整') ? effect('線幅 調整')('スライダー') : 0;\n" +
                                       "Math.max(0, base + adj);";
            } else {
                widthProp.setValue(opt.strokeWidth);
            }
            if (opt.strokeColor) stroke.property("ADBE Vector Stroke Color").setValue(opt.strokeColor);
            // 念のため線を末尾に移動しておく（フィルやパスより下に配置）
            try { stroke.moveTo(g.numProperties); } catch(e) {}
        }
        return {stroke:stroke, fill:fill};
    }

    function ensureCheckboxEffect(layer, name, checked) {
        var fx = layer.property("ADBE Effect Parade");
        if (!fx) return null;
        var cb = fx.property(name);
        if (!cb) {
            cb = fx.addProperty("ADBE Checkbox Control");
            cb.name = name;
        }
        cb.property("ADBE Checkbox Control-0001").setValue(checked ? 1 : 0);
        return cb;
    }

    function getCheckboxEffectValue(layer, name, defVal) {
        try {
            var fx = layer.property("ADBE Effect Parade");
            if (!fx) return !!defVal;
            var cb = fx.property(name);
            if (!cb) return !!defVal;
            return cb.property("ADBE Checkbox Control-0001").value > 0.5;
        } catch (e) {
            return !!defVal;
        }
    }

    function addPaddingAndCornerEffects(layer, padX, padY, corner, usePct, shrinkX, shrinkY) {
        var fx = layer.property("ADBE Effect Parade");
        function addSlider(name, val){
            var sld = fx.addProperty("ADBE Slider Control");
            sld.name = name;
            sld.property("ADBE Slider Control-0001").setValue(val);
            return sld;
        }
        addSlider("余白 X", padX);
        addSlider("余白 Y", padY);
        addSlider("余白%モード", usePct ? 1 : 0);
        addSlider("縮小 左右%", shrinkX || 0);
        addSlider("縮小 上下%", shrinkY || 0);
        addSlider("線幅 調整", 0);
        addSlider("ブラケット線幅 調整", 0);
        addSlider("角丸", corner);
        ensureCheckboxEffect(layer, "文字追従 有効", true);
    }

    function addBracketEffects(layer, opt) {
        opt = opt || {};
        var fx = layer.property("ADBE Effect Parade");
        function addSlider(name, val){
            var sld = fx.addProperty("ADBE Slider Control");
            sld.name = name;
            sld.property("ADBE Slider Control-0001").setValue(val);
            return sld;
        }
        addSlider("コーナーブラケット", opt.bracketOn ? 1 : 0);
        addSlider("ブラケット長", opt.bracketLength || 0);
        addSlider("ブラケットスタイル", opt.bracketStyle || 0);
        addSlider("ブラケット線幅", opt.bracketStrokeWidth || 0);
        var corners = opt.bracketCorners || {};
        addSlider("ブラケット 左上", corners.lt ? 1 : 0);
        addSlider("ブラケット 右上", corners.rt ? 1 : 0);
        addSlider("ブラケット 左下", corners.lb ? 1 : 0);
        addSlider("ブラケット 右下", corners.rb ? 1 : 0);
    }

    function addSideLineEffects(layer, opt) {
        opt = opt || {};
        var fx = layer.property("ADBE Effect Parade");
        function addSlider(name, val){
            var sld = fx.addProperty("ADBE Slider Control");
            sld.name = name;
            sld.property("ADBE Slider Control-0001").setValue(val);
            return sld;
        }
        addSlider("サイドライン", opt.sideLineOn ? 1 : 0);
        addSlider("サイドライン線幅", opt.sideLineStrokeWidth || 0);
        addSlider("サイドライン 上", opt.sideLineSides ? (opt.sideLineSides.top ? 1 : 0) : 0);
        addSlider("サイドライン 下", opt.sideLineSides ? (opt.sideLineSides.bottom ? 1 : 0) : 0);
        addSlider("サイドライン 左", opt.sideLineSides ? (opt.sideLineSides.left ? 1 : 0) : 0);
        addSlider("サイドライン 右", opt.sideLineSides ? (opt.sideLineSides.right ? 1 : 0) : 0);
        addSlider("サイドライン 上 縮小%", opt.sideLineShrink ? (opt.sideLineShrink.top || 0) : 0);
        addSlider("サイドライン 下 縮小%", opt.sideLineShrink ? (opt.sideLineShrink.bottom || 0) : 0);
        addSlider("サイドライン 左 縮小%", opt.sideLineShrink ? (opt.sideLineShrink.left || 0) : 0);
        addSlider("サイドライン 右 縮小%", opt.sideLineShrink ? (opt.sideLineShrink.right || 0) : 0);
        addSlider("サイドライン線幅 調整", 0);
    }

function ensureFixedBaseEffects(layer, baseSize, basePos) {
        var fx = layer.property("ADBE Effect Parade");

        function ensureSlider(name, def){
            var sld = fx.property(name);
            if (!sld) {
                sld = fx.addProperty("ADBE Slider Control");
                sld.name = name;
            }
            if (def !== undefined && def !== null) {
                sld.property("ADBE Slider Control-0001").setValue(def);
            }
            return sld.property("ADBE Slider Control-0001");
        }

        function ensurePoint(name, def){
            var pt = fx.property(name);
            if (!pt) {
                pt = fx.addProperty("ADBE Point Control");
                pt.name = name;
            }
            if (def !== undefined && def !== null) {
                pt.property("ADBE Point Control-0001").setValue(def);
            }
            return pt.property("ADBE Point Control-0001");
        }

        var baseW = ensureSlider("固定ベース幅", baseSize ? baseSize[0] : null);
        var baseH = ensureSlider("固定ベース高さ", baseSize ? baseSize[1] : null);
        var baseP = ensurePoint("固定ベース位置", basePos);

        return { width: baseW, height: baseH, pos: baseP };
    }

    function applyExpression(prop, expr) {
        if (!prop || !prop.canSetExpression) return;
        prop.expressionEnabled = false;
        try { prop.expression = ""; } catch (e) {}
        prop.expression = expr;
        prop.expressionEnabled = true;
    }

    function addCornerBrackets(shapeLayer, mode, targetNames, option, includeExtents) {
        option = option || {};
        var contents = shapeLayer.property("Contents");
        var root = contents.addProperty("ADBE Vector Group");
        root.name = "CornerBrackets";
        var rootContents = root.property("Contents");
        var rootOpacity = root.property("Transform").property("Opacity");
        if (rootOpacity && rootOpacity.canSetExpression) {
            rootOpacity.expression =
                "var e = effect('コーナーブラケット');\n" +
                "e ? e('スライダー') * 100 : 0;";
        }

        var corners = [
            {label:"左上", cx:0, cy:0, dx:1,  dy:1},
            {label:"右上", cx:1, cy:0, dx:-1, dy:1},
            {label:"左下", cx:0, cy:1, dx:1,  dy:-1},
            {label:"右下", cx:1, cy:1, dx:-1, dy:-1}
        ];

        for (var i=0;i<corners.length;i++){
            var c = corners[i];
            var gp = rootContents.addProperty("ADBE Vector Group");
            gp.name = "Bracket " + c.label;
            var pathShape = gp.property("Contents").addProperty("ADBE Vector Shape - Group");
            var pathProp = pathShape.property("Path");
            applyExpression(pathProp, buildBracketPathExpr(c.label, c.dx, c.dy));
            var posProp = gp.property("Transform").property("Position");
            applyExpression(posProp, buildBracketPosExpr(mode, targetNames, includeExtents, c.cx, c.cy, option.shrinkX, option.shrinkY));
        }

        // ストロークは全てのブラケットパスの後ろ（下）に配置して適用する
        var stroke = rootContents.addProperty("ADBE Vector Graphic - Stroke");
        var brStrokeW = option.bracketStrokeWidth || option.strokeWidth || 4;
        var widthProp = stroke.property("ADBE Vector Stroke Width");
        if (widthProp.canSetExpression) {
            widthProp.expression =
                "var baseCtrl = effect('ブラケット線幅');\n" +
                "var base = baseCtrl ? baseCtrl('スライダー') : " + brStrokeW + ";\n" +
                "var adj = effect('ブラケット線幅 調整') ? effect('ブラケット線幅 調整')('スライダー') : 0;\n" +
                "Math.max(0, base + adj);";
        } else {
            widthProp.setValue(brStrokeW);
        }
        var brColor = option.bracketStrokeColor || option.strokeColor;
        if (brColor) stroke.property("ADBE Vector Stroke Color").setValue(brColor);
        try { stroke.moveTo(rootContents.numProperties); } catch(e) {}
    }

    function addSideLines(shapeLayer, mode, targetNames, option, includeExtents) {
        option = option || {};
        var contents = shapeLayer.property("Contents");
        var root = contents.addProperty("ADBE Vector Group");
        root.name = "SideLines";
        var rootContents = root.property("Contents");
        var rootOpacity = root.property("Transform").property("Opacity");
        if (rootOpacity && rootOpacity.canSetExpression) {
            rootOpacity.expression =
                "var e = effect('サイドライン');\n" +
                "e ? e('スライダー') * 100 : 0;";
        }

        var sides = [
            {label:"上", key:"top",    orientation:"h"},
            {label:"下", key:"bottom", orientation:"h"},
            {label:"左", key:"left",   orientation:"v"},
            {label:"右", key:"right",  orientation:"v"}
        ];

        for (var i=0;i<sides.length;i++){
            var s = sides[i];
            var gp = rootContents.addProperty("ADBE Vector Group");
            gp.name = "SideLine " + s.label;
            var pathShape = gp.property("Contents").addProperty("ADBE Vector Shape - Group");
            var pathProp = pathShape.property("Path");
            applyExpression(pathProp, buildSideLinePathExpr(mode, targetNames, includeExtents, s.label, s.orientation, option.shrinkX, option.shrinkY));
            var posProp = gp.property("Transform").property("Position");
            applyExpression(posProp, buildSideLinePosExpr(mode, targetNames, includeExtents, s.key, option.shrinkX, option.shrinkY));
        }

        var stroke = rootContents.addProperty("ADBE Vector Graphic - Stroke");
        var lineStrokeW = option.sideLineStrokeWidth || option.strokeWidth || 4;
        var widthProp = stroke.property("ADBE Vector Stroke Width");
        if (widthProp.canSetExpression) {
            widthProp.expression =
                "var baseCtrl = effect('サイドライン線幅');\n" +
                "var base = baseCtrl ? baseCtrl('スライダー') : " + lineStrokeW + ";\n" +
                "var adj = effect('サイドライン線幅 調整') ? effect('サイドライン線幅 調整')('スライダー') : 0;\n" +
                "Math.max(0, base + adj);";
        } else {
            widthProp.setValue(lineStrokeW);
        }
        var lineColor = option.sideLineStrokeColor || option.strokeColor;
        if (lineColor) stroke.property("ADBE Vector Stroke Color").setValue(lineColor);
        try { stroke.moveTo(rootContents.numProperties); } catch(e) {}
    }

function createAutoRectForTargets(comp, targets, option) {
        var created = [];


        // ------------ 選択全体で 1 つ ----------
        if (option.multiMode === "all") {
            var topTgt  = targets[0];
            var base    = "Rect_ALL";
            var shpName = uniqueNameInComp(comp, base);
            var shape   = comp.layers.addShape();
            shape.name  = shpName;
            shape.threeDLayer = topTgt.threeDLayer;
            try { shape.label = option.shapeLabel; } catch(eLabelAll) {}

            var contents = shape.property("Contents");
            var gp   = contents.addProperty("ADBE Vector Group");
            gp.name  = "AutoRect";
            var rect = gp.property("Contents").addProperty("ADBE Vector Shape - Rect");

            addPaddingAndCornerEffects(shape, option.paddingX, option.paddingY, option.cornerRadius, option.usePaddingPercent);
            addBracketEffects(shape, option);
            addSideLineEffects(shape, option);

            var names = [];
            for (var i=0;i<targets.length;i++) names.push(targets[i].name);

            rect.property("Size").expression      = buildRectSizeExpr("multi", names, option.includeExtents, option.shrinkX, option.shrinkY);
            rect.property("Position").expression  = buildRectPosExpr("multi", names, option.includeExtents, option.shrinkX, option.shrinkY);
            rect.property("Roundness").expression = buildRoundnessExpr();

            ensureStrokeFill(gp, option);
            addCornerBrackets(shape, "multi", names, option, option.includeExtents);
            addSideLines(shape, "multi", names, option, option.includeExtents);

            matchParentTransform(shape, topTgt);
            linkLayerTransformByExpr(shape, topTgt);

            shape.adjustmentLayer = !!option.makeAdjustment;

            var insertAbove = option.insertAbove ^ getKeyboardShift();
            if (insertAbove) shape.moveBefore(topTgt); else shape.moveAfter(topTgt);

            if (option.setTrackMatte) {
                alert("「選択全体を囲う1つ」ではトラックマット設定は行いません。");
            }

            created.push({shape:shape, target:topTgt});

        // ------------ 各レイヤーにつき 1 つ ----------
        } else {
            for (var i=0;i<targets.length;i++){
                var tgt = targets[i];
                if (!tgt) continue;
                if (!tgt.sourceRectAtTime) continue; // バウンディングが取れないレイヤーは無視
                if (tgt.locked || !tgt.enabled) {
                    alert("ロック中、または非表示のレイヤーがあります: " + tgt.name);
                    continue;
                }

                var baseName = "Rect_" + tgt.name;
                var shpName  = uniqueNameInComp(comp, baseName);

                var shape = comp.layers.addShape();
                shape.name       = shpName;
                shape.threeDLayer = tgt.threeDLayer;
                try { shape.label = option.shapeLabel; } catch(eLabelEach) {}

                var contents = shape.property("Contents");
                var gp   = contents.addProperty("ADBE Vector Group");
                gp.name  = "AutoRect";
                var rect = gp.property("Contents").addProperty("ADBE Vector Shape - Rect");

                addPaddingAndCornerEffects(shape, option.paddingX, option.paddingY, option.cornerRadius, option.usePaddingPercent);
                addBracketEffects(shape, option);
                addSideLineEffects(shape, option);

                var modeName = "direct";
                rect.property("Size").expression      = buildRectSizeExpr(modeName, [tgt.name], option.includeExtents, option.shrinkX, option.shrinkY);
                rect.property("Position").expression  = buildRectPosExpr(modeName, [tgt.name], option.includeExtents, option.shrinkX, option.shrinkY);
                matchParentTransform(shape, tgt);
                linkLayerTransformByExpr(shape, tgt);
                rect.property("Roundness").expression = buildRoundnessExpr();

                ensureStrokeFill(gp, option);
                addCornerBrackets(shape, modeName, [tgt.name], option, option.includeExtents);
                addSideLines(shape, modeName, [tgt.name], option, option.includeExtents);

                shape.adjustmentLayer = !!option.makeAdjustment;

                // 「上に作成」＋Shift 反転の値をここで確定
                var insertAbove = option.insertAbove ^ getKeyboardShift();
                if (insertAbove) {
                    shape.moveBefore(tgt);
                } else {
                    shape.moveAfter(tgt);
                }

                if (option.setTrackMatte && isTrackMatteCapableLayer(tgt)) {
                    if (!confirmOverwriteMatte(tgt)) {
                        // スキップ
                    } else {
                        // ★ insertAbove を渡すことで、
                        //   ・新UI → insertAbove が true のときだけ上に移動
                        //   ・旧UI → 常に直上へ（関数内で強制）
                        applyAlphaTrackMatte(tgt, shape, insertAbove);
                    }
                }

                created.push({shape:shape, target:tgt});
            }
        }
        return created;
    }

    // Bake 対象抽出
    function pickCandidateShapesFromSelection(comp) {
        var out = [];
        var sel = comp.selectedLayers;
        for (var i=0;i<sel.length;i++){
            var L = sel[i];
            if (!(L instanceof ShapeLayer)) continue;
            var fx = L.property("ADBE Effect Parade");
            var ok = false;
            if (fx && fx.property("余白 X") && fx.property("余白 Y") && fx.property("角丸")) ok = true;
            if (ok) out.push(L);
        }
        return out;
    }

    // ★修正: 長方形パス(Rect)の取得ロジックを matchName 検索に変更
    function getRectProps(layer) {
        var rects = [];
        var contents = layer.property("Contents");
        if (!contents) return rects;

        // 内部関数：グループ内の Rect Path を探す
        function findRectInGroup(groupProp) {
            var gContents = groupProp.property("Contents");
            if (!gContents) return null;
            for (var k = 1; k <= gContents.numProperties; k++) {
                var p = gContents.property(k);
                if (p.matchName === "ADBE Vector Shape - Rect") {
                    return p;
                }
            }
            return null;
        }

        // 1. "AutoRect" という名前のグループを優先検索
        var auto = contents.property("AutoRect");
        if (auto && auto.matchName === "ADBE Vector Group") {
            var r = findRectInGroup(auto);
            if (r) rects.push(r);
        }

        // 2. それ以外も走査 (念のため)
        for (var i = 1; i <= contents.numProperties; i++) {
            var p = contents.property(i);
            if (p.matchName === "ADBE Vector Group") {
                // さっき追加した "AutoRect" は除外
                if (auto && p === auto) continue;
                var rr = findRectInGroup(p);
                if (rr) rects.push(rr);
            }
        }
        return rects;
    }

    // Rect プロパティから Size / Position / Roundness を matchName で取得
    function getRectSizePosRoundProps(rectProp) {
        var sz = null, ps = null, rd = null;
        for (var i = 1; i <= rectProp.numProperties; i++) {
            var p = rectProp.property(i);
            switch (p.matchName) {
                case "ADBE Vector Rect Size":
                    sz = p; break;
                case "ADBE Vector Rect Position":
                    ps = p; break;
                case "ADBE Vector Rect Roundness":
                    rd = p; break;
            }
        }
        return { size: sz, pos: ps, round: rd };
    }


    // シェイプレイヤー内を再帰的に走査して、RectSize/Pos/Round と変形系の
    // エクスプレッションを処理
    function visitPropsWithExpression(layer, callback) {
        function scan(propGroup) {
            if (!propGroup || propGroup.numProperties === undefined) return;

            for (var i = 1; i <= propGroup.numProperties; i++) {
                var p = propGroup.property(i);
                if (p.canSetExpression && p.expression !== "") {
                    callback(p);
                }

                if (p.numProperties > 0) scan(p);
            }
        }

        scan(layer.property("Contents"));
        scan(layer.transform);
    }

    function bakeLayers(ls, time) {
        for (var i = 0; i < ls.length; i++) {
            var L = ls[i];

            visitPropsWithExpression(L, function(prop){
                var v = prop.valueAtTime(time, false);
                if (prop.isTimeVarying) {
                    prop.setValueAtTime(time, v);
                } else {
                    prop.setValue(v);
                }
                prop.expressionEnabled = false;
                prop.expression = ""; // 永続的に固定
            });
        }
    }

    function clearAllKeys(prop) {
        try {
            while (prop.numKeys && prop.numKeys > 0) prop.removeKey(1);
        } catch(e) {}
    }

    function copyKeyframedProperty(srcProp, dstProp) {
        if (!srcProp || !dstProp) return;
        try {
            if (dstProp.canSetExpression) {
                dstProp.expression = srcProp.expression;
                dstProp.expressionEnabled = srcProp.expressionEnabled;
            }
        } catch(eExpr) {}

        if (srcProp.numKeys && srcProp.numKeys > 0) {
            clearAllKeys(dstProp);
            for (var k = 1; k <= srcProp.numKeys; k++) {
                var t = srcProp.keyTime(k);
                var v = srcProp.keyValue(k);
                dstProp.setValueAtTime(t, v);

                try {
                    dstProp.setInterpolationTypeAtKey(k, srcProp.keyInInterpolationType(k), srcProp.keyOutInterpolationType(k));
                } catch(eInterp) {}
                try {
                    dstProp.setTemporalEaseAtKey(k, srcProp.keyInTemporalEase(k), srcProp.keyOutTemporalEase(k));
                } catch(eEase) {}
                try {
                    dstProp.setTemporalAutoBezierAtKey(k, srcProp.keyTemporalAutoBezier(k));
                } catch(eTA) {}
                try {
                    dstProp.setTemporalContinuousAtKey(k, srcProp.keyTemporalContinuous(k));
                } catch(eTC) {}
                try {
                    dstProp.setRovingAtKey(k, srcProp.keyRoving(k));
                } catch(eRoving) {}
                try {
                    if (srcProp.isSpatial) {
                        dstProp.setSpatialAutoBezierAtKey(k, srcProp.keySpatialAutoBezier(k));
                        dstProp.setSpatialContinuousAtKey(k, srcProp.keySpatialContinuous(k));
                        dstProp.setSpatialTangentsAtKey(k, srcProp.keyInSpatialTangent(k), srcProp.keyOutSpatialTangent(k));
                    }
                } catch(eSpatial) {}
            }
        } else {
            clearAllKeys(dstProp);
            try {
                if (dstProp.propertyValueType !== PropertyValueType.NO_VALUE) {
                    dstProp.setValue(srcProp.value);
                }
            } catch(eSet) {}
        }
    }

    function copyEffectParamByName(srcLayer, dstLayer, effectName) {
        var srcFx = srcLayer.property("ADBE Effect Parade");
        var dstFx = dstLayer.property("ADBE Effect Parade");
        if (!srcFx || !dstFx) return;
        var srcEf = srcFx.property(effectName);
        if (!srcEf) return;
        var dstEf = dstFx.property(effectName);
        if (!dstEf) {
            try {
                dstEf = dstFx.addProperty(srcEf.matchName);
                dstEf.name = effectName;
            } catch(eAddEf) {
                return;
            }
        }
        if (srcEf.numProperties >= 1 && dstEf.numProperties >= 1) {
            copyKeyframedProperty(srcEf.property(1), dstEf.property(1));
        }
    }

    function copyVectorGraphicProps(srcLayer, dstLayer) {
        var names = [
            "ADBE Vector Stroke Width",
            "ADBE Vector Stroke Color",
            "ADBE Vector Stroke Opacity",
            "ADBE Vector Fill Color",
            "ADBE Vector Fill Opacity"
        ];
        function scan(srcGroup, dstGroup) {
            if (!srcGroup || !dstGroup || srcGroup.numProperties === undefined || dstGroup.numProperties === undefined) return;
            var n = Math.min(srcGroup.numProperties, dstGroup.numProperties);
            for (var i = 1; i <= n; i++) {
                var sp = srcGroup.property(i);
                var dp = dstGroup.property(i);
                if (!sp || !dp) continue;
                if (sp.matchName !== dp.matchName) continue;
                for (var j = 0; j < names.length; j++) {
                    if (sp.matchName === names[j]) {
                        copyKeyframedProperty(sp, dp);
                        break;
                    }
                }
                if (sp.numProperties > 0 && dp.numProperties > 0) scan(sp, dp);
            }
        }
        scan(srcLayer.property("Contents"), dstLayer.property("Contents"));
    }

    function syncAutoRectParamsFromSource(sourceLayer, targetLayers) {
        if (!sourceLayer || !targetLayers || targetLayers.length === 0) return;

        var effectNames = [
            "余白 X", "余白 Y", "余白%モード", "縮小 左右%", "縮小 上下%", "線幅 調整", "角丸",
            "コーナーブラケット", "ブラケット長", "ブラケットスタイル", "ブラケット線幅", "ブラケット線幅 調整",
            "ブラケット 左上", "ブラケット 右上", "ブラケット 左下", "ブラケット 右下",
            "サイドライン", "サイドライン線幅", "サイドライン線幅 調整",
            "サイドライン 上", "サイドライン 下", "サイドライン 左", "サイドライン 右",
            "サイドライン 上 縮小%", "サイドライン 下 縮小%", "サイドライン 左 縮小%", "サイドライン 右 縮小%",
            "文字追従 有効"
        ];

        for (var i = 0; i < targetLayers.length; i++) {
            var dst = targetLayers[i];
            if (!dst || dst === sourceLayer) continue;

            for (var e = 0; e < effectNames.length; e++) {
                copyEffectParamByName(sourceLayer, dst, effectNames[e]);
            }
            copyVectorGraphicProps(sourceLayer, dst);
            try { dst.label = sourceLayer.label; } catch(eLabel) {}
        }
    }

    // 余白固定（シンプル版）
    // ・現在の見た目のサイズ＆位置をベースに固定
    // ・以降はテキストの変化には追従せず、余白スライダーだけ反映
    function lockWithPadding(ls, time) {
        for (var i = 0; i < ls.length; i++) {
            var L = ls[i];
            if (!(L instanceof ShapeLayer)) continue;

            var fx = L.property("ADBE Effect Parade");
            if (!fx) continue;

            var padXef = fx.property("余白 X");
            var padYef = fx.property("余白 Y");
            if (!padXef || !padYef) continue;

            var padX = padXef.property(1).value;
            var padY = padYef.property(1).value;

            visitPropsWithExpression(L, function(prop){
                var v = prop.valueAtTime(time, false);
                prop.expression = "";
                prop.expressionEnabled = false;
                if (prop.isTimeVarying) {
                    prop.setValueAtTime(time, v);
                } else {
                    prop.setValue(v);
                }
            });
            ensureCheckboxEffect(L, "文字追従 有効", false);
        }
    }



    // AutoRect用のターゲットレイヤーを推定
    function findAutoRectTarget(comp, shapeLayer) {
        if (!comp || !shapeLayer) return null;

        var target = null;

        // 名前が "Rect_○○" の場合、○○ という名前のレイヤーを探す
        var nm = shapeLayer.name;
        if (nm.indexOf("Rect_") === 0) {
            var base = nm.substring("Rect_".length);
            for (var i = 1; i <= comp.numLayers; i++) {
                var L = comp.layer(i);
                if (L.name === base && L.sourceRectAtTime) {
                    target = L;
                    break;
                }
            }
        }

        // 見つからなければ、親レイヤーが sourceRectAtTime を持っていればそれを採用
        if (!target && shapeLayer.parent && shapeLayer.parent.sourceRectAtTime) {
            target = shapeLayer.parent;
        }

        return target;
    }

    // 「文字追従停止」状態から元のテキスト追従エクスプレッションに戻す
    function unlockPadding(ls, comp) {
        if (!comp) return;

        for (var i = 0; i < ls.length; i++) {
            var L = ls[i];
            if (!(L instanceof ShapeLayer)) continue;

            var fx = L.property("ADBE Effect Parade");
            if (!fx) continue;

            // このツールで作ったシェイプかどうか（余白X/Y の有無で判定）
            var padXef = fx.property("余白 X");
            var padYef = fx.property("余白 Y");
            if (!padXef || !padYef) continue;

            // ★ FIX:
            // ここで「固定ベース幅/高さ/位置」がないとスキップしていたが、
            // 現在の lockWithPadding(文字追従停止) ではそれらを作っていないので、
            // この判定は削除する。
            // （文字追従停止済みかどうかは、実際に Size/Pos が固定式に変わっているかで十分）

            // 対象のテキストレイヤーを推定
            var target = findAutoRectTarget(comp, L);
            if (!target || !target.sourceRectAtTime) {
                // ターゲットが見つからない場合は復活不能
                continue;
            }

            var shrinkXVal = 0, shrinkYVal = 0;
            var mode = "direct";

            // 段落テキスト拡張境界を含めるかは元情報が無いので、とりあえず true で復活
            var includeExtents = true;

            var rects = getRectProps(L);
            for (var j = 0; j < rects.length; j++) {
                var props = getRectSizePosRoundProps(rects[j]);

                // Size：元の AutoRect 式を再設定
                if (props.size) {
                    var szExpr = buildRectSizeExpr(mode, [target.name], includeExtents, shrinkXVal, shrinkYVal);
                    applyExpression(props.size, szExpr);
                }

                // Position：元の AutoRect 式を再設定
                if (props.pos) {
                    var posExpr = buildRectPosExpr(mode, [target.name], includeExtents, shrinkXVal, shrinkYVal);
                    applyExpression(props.pos, posExpr);
                }

                // Roundness：常に「角丸」エフェクト追従に戻す
                if (props.round) {
                    var rdExpr = buildRoundnessExpr();
                    applyExpression(props.round, rdExpr);
                }
            }

            linkLayerTransformByExpr(L, target);
            ensureCheckboxEffect(L, "文字追従 有効", true);

            // 固定ベース用エフェクトがあってもそのまま残す（現状は使っていない）
        }
    }

    function applyFollowStateFromEffects(ls, comp, time) {
        if (!comp) return;
        var toLock = [], toUnlock = [];
        for (var i = 0; i < ls.length; i++) {
            var L = ls[i];
            if (!(L instanceof ShapeLayer)) continue;
            var isFollow = getCheckboxEffectValue(L, "文字追従 有効", true);
            if (isFollow) toUnlock.push(L);
            else toLock.push(L);
        }
        if (toLock.length) lockWithPadding(toLock, time);
        if (toUnlock.length) unlockPadding(toUnlock, comp);
    }





    function getExistingWindowSingleton() {
        try {
            var g = $.global;
            if (!g) return null;
            var w = g[GLOBAL_UI_KEY];
            if (!w) return null;
            try {
                if (w.visible !== undefined) return w;
            } catch (eVisible) {
                return null;
            }
        } catch (e) {}
        return null;
    }

    function storeWindowSingleton(win) {
        try { $.global[GLOBAL_UI_KEY] = win; } catch (e) {}
    }

    function clearWindowSingleton(win) {
        try {
            if ($.global[GLOBAL_UI_KEY] === win) {
                $.global[GLOBAL_UI_KEY] = null;
            }
        } catch (e) {}
    }

    // -----------------------------
    // UI 構築
    // -----------------------------
    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, {resizeable:true});

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 8;
        pal.margins = 10;

        function createButtonTabs(parent, labels) {
            var root = parent.add("group");
            root.orientation = "column";
            root.alignChildren = ["fill", "top"];
            root.spacing = 6;

            var bar = root.add("group");
            bar.orientation = "row";
            bar.alignChildren = ["left", "center"];
            bar.spacing = 6;
            bar.alignment = "fill";

            var stack = root.add("group");
            stack.orientation = "stack";
            stack.alignChildren = ["fill", "fill"];
            stack.alignment = ["fill", "fill"];

            var btns = [];
            var pages = [];

            function select(i) {
                for (var k = 0; k < pages.length; k++) {
                    var isOn = (k === i);
                    pages[k].visible = isOn;
                    pages[k].enabled = isOn;
                    btns[k].enabled = !isOn;
                }
                stack.layout.layout(true);
                root.layout.layout(true);
                parent.layout.layout(true);
            }

            for (var i = 0; i < labels.length; i++) {
                (function (idx) {
                    var b = bar.add("button", undefined, labels[idx]);
                    b.onClick = function () { select(idx); };
                    btns.push(b);

                    var page = stack.add("group");
                    page.orientation = "column";
                    page.alignChildren = ["fill", "top"];
                    page.visible = false;
                    page.enabled = false;
                    pages.push(page);
                })(i);
            }

            if (pages.length > 0) select(0);

            return { root: root, bar: bar, stack: stack, pages: pages, select: select };
        }

        var tabs = createButtonTabs(pal, ["メイン", "設定"]);
        var pageMain = tabs.pages[0];
        var pageSettings = tabs.pages[1];

        // 上部：選択情報
        var infoGrp = pageMain.add("group");
        infoGrp.orientation = "column";
        infoGrp.alignChildren = "left";
        infoGrp.alignment = "fill";

        var selTxt  = infoGrp.add("statictext", undefined, "選択：なし");
        selTxt.characters = 40;
        var warnTxt = infoGrp.add("statictext", undefined, "");
        warnTxt.characters = 40;

        // メインボタン
        var btnGrid = pageMain.add("group");
        btnGrid.orientation = "column";
        btnGrid.alignChildren = ["fill", "top"];
        btnGrid.alignment = "fill";
        btnGrid.spacing = 8;

        var btnGrp = btnGrid.add("group");
        btnGrp.orientation = "row";
        btnGrp.alignment = "fill";
        var btCreate   = btnGrp.add("button", undefined, "作成 (Create)");
        var btLockPad  = btnGrp.add("button", undefined, "文字追従停止");
        var btUnlockPad = btnGrp.add("button", undefined, "文字追従復活");

        var btnGrp2 = btnGrid.add("group");
        btnGrp2.orientation = "row";
        btnGrp2.alignment = "fill";
        var btApplyFollow = btnGrp2.add("button", undefined, "追従チェック反映");
        var btCopyParams = btnGrp2.add("button", undefined, "最後選択の設定を他へ反映");
        var btBake     = btnGrp2.add("button", undefined, "Bake 固定化");

        // スイッチ列
        var sw = pageSettings.add("group");
        sw.orientation = "row";
        sw.alignment   = "fill";
        var ckInsertAbove = sw.add("checkbox", undefined, "上に挿入");
        var ckAdj         = sw.add("checkbox", undefined, "調整レイヤーにする");
        var ckMatte       = sw.add("checkbox", undefined, "トラックマット(アルファ)");
        var ckAllowAuto   = sw.add("checkbox", undefined, "重複許可");

        // オプション
        var opt = pageSettings.add("panel", undefined, "オプション");
        opt.orientation = "column";
        opt.alignChildren = "left";
        opt.alignment = "fill";

        function addSliderRow(parent, label, settingKey, defVal, minVal, maxVal, chars) {
            var row = parent.add("group");
            row.add("statictext", undefined, label);
            var et = row.add("edittext", undefined, String(defVal));
            et.characters = chars || 6;
            var sl = row.add("slider", undefined, num(et.text, defVal), minVal, maxVal);
            sl.preferredSize = [160, 18];
            return {row: row, edit: et, slider: sl};
        }

        var padXRow = addSliderRow(opt, "余白 X", "padX", 16, 0, 300, 6);
        var padYRow = addSliderRow(opt, "余白 Y", "padY", 8, 0, 300, 6);
        var cornerRow = addSliderRow(opt, "角丸", "corner", 0, 0, 100, 6);
        var etPadX = padXRow.edit;
        var etPadY = padYRow.edit;
        var etCorner = cornerRow.edit;

        var rowUnit = opt.add("group");
        rowUnit.add("statictext", undefined, "余白単位");
        var ddPadUnit = rowUnit.add("dropdownlist", undefined, ["px", "%"]);
        var padUnitDef = DEFAULT_UI.padUnit;
        ddPadUnit.selection = (padUnitDef === "%") ? 1 : 0;

        var row2 = opt.add("group");
        var ckExt = row2.add("checkbox", undefined, "段落テキストの拡張境界を含める（Include Extents）");
        ckExt.value = DEFAULT_UI.includeExt;

        var row3 = opt.add("group");
        var ckStroke = row3.add("checkbox", undefined, "線（Stroke）");
        ckStroke.value = DEFAULT_UI.strokeOn;
        var strokeRow = addSliderRow(opt, "線幅", "strokeW", 4, 0, 50, 4);
        var etStrokeW = strokeRow.edit;
        var slStrokeW = strokeRow.slider;

        var row4 = opt.add("group");
        var ckFill = row4.add("checkbox", undefined, "塗り（Fill）");
        ckFill.value = DEFAULT_UI.fillOn;

        var strokeSwatch = createColorSwatch(row4, "線色", [
            DEFAULT_UI.strokeColor[0],
            DEFAULT_UI.strokeColor[1],
            DEFAULT_UI.strokeColor[2]
        ], "矩形の線色を設定します。");
        var fillSwatch = createColorSwatch(row4, "塗り色", [
            DEFAULT_UI.fillColor[0],
            DEFAULT_UI.fillColor[1],
            DEFAULT_UI.fillColor[2]
        ], "矩形の塗り色を設定します。");

        var rowLabel = opt.add("group");
        rowLabel.add("statictext", undefined, "ラベルカラー");
        var labelItems = [
            "0: なし", "1", "2", "3", "4", "5", "6", "7", "8",
            "9 (推奨)", "10", "11", "12", "13", "14", "15", "16"
        ];
        var ddLabelColor = rowLabel.add("dropdownlist", undefined, labelItems);
        var labelDef = clamp(Math.round(num(DEFAULT_UI.shapeLabel, 9)), 0, 16);
        ddLabelColor.selection = labelDef;

        var brPanel = opt.add("panel", undefined, "コーナーブラケット");
        brPanel.orientation = "column";
        brPanel.alignChildren = "left";
        var brTop = brPanel.add("group");
        var ckBracket = brTop.add("checkbox", undefined, "コーナーブラケット");
        ckBracket.value = DEFAULT_UI.bracketOn;
        var brLenRow = addSliderRow(brPanel, "長さ", "bracketLen", 24, 0, 300, 5);
        var etBracketLen = brLenRow.edit;
        var slBracketLen = brLenRow.slider;
        var brStyleRow = brPanel.add("group");
        brStyleRow.add("statictext", undefined, "スタイル");
        var ddBracketStyle = brStyleRow.add("dropdownlist", undefined, ["内向き","外向き"]);
        var brStyleDef = num(DEFAULT_UI.bracketStyle, 0);
        ddBracketStyle.selection = (brStyleDef >= 1) ? 1 : 0;

        var brRow = brPanel.add("group");
        brRow.add("statictext", undefined, "角:");
        var ckBrLT = brRow.add("checkbox", undefined, "左上");
        var ckBrRT = brRow.add("checkbox", undefined, "右上");
        var ckBrLB = brRow.add("checkbox", undefined, "左下");
        var ckBrRB = brRow.add("checkbox", undefined, "右下");
        ckBrLT.value = DEFAULT_UI.bracketLT;
        ckBrRT.value = DEFAULT_UI.bracketRT;
        ckBrLB.value = DEFAULT_UI.bracketLB;
        ckBrRB.value = DEFAULT_UI.bracketRB;
        var brStrokeRow = addSliderRow(brPanel, "線幅", "bracketStrokeW", 4, 0, 50, 4);
        var etBracketStroke = brStrokeRow.edit;
        var slBracketStroke = brStrokeRow.slider;
        var brColorSwatch = createColorSwatch(brStrokeRow.row, "線色", [
            DEFAULT_UI.bracketStrokeColor[0],
            DEFAULT_UI.bracketStrokeColor[1],
            DEFAULT_UI.bracketStrokeColor[2]
        ], "コーナーブラケットの線色を設定します。");

        var sidePanel = opt.add("panel", undefined, "サイドライン");
        sidePanel.orientation = "column";
        sidePanel.alignChildren = "left";
        var sideTop = sidePanel.add("group");
        var ckSideLine = sideTop.add("checkbox", undefined, "サイドライン");
        ckSideLine.value = DEFAULT_UI.sideLineOn;

        var sideRow = sidePanel.add("group");
        sideRow.add("statictext", undefined, "方向:");
        var ckSideTop = sideRow.add("checkbox", undefined, "上");
        var ckSideBottom = sideRow.add("checkbox", undefined, "下");
        var ckSideLeft = sideRow.add("checkbox", undefined, "左");
        var ckSideRight = sideRow.add("checkbox", undefined, "右");
        ckSideTop.value = DEFAULT_UI.sideLineTop;
        ckSideBottom.value = DEFAULT_UI.sideLineBottom;
        ckSideLeft.value = DEFAULT_UI.sideLineLeft;
        ckSideRight.value = DEFAULT_UI.sideLineRight;

        var sideStrokeRow = addSliderRow(sidePanel, "線幅", "sideLineStrokeW", 4, 0, 50, 4);
        var etSideLineStroke = sideStrokeRow.edit;
        var slSideLineStroke = sideStrokeRow.slider;
        var sideColorSwatch = createColorSwatch(sideStrokeRow.row, "線色", [
            DEFAULT_UI.sideLineStrokeColor[0],
            DEFAULT_UI.sideLineStrokeColor[1],
            DEFAULT_UI.sideLineStrokeColor[2]
        ], "サイドラインの線色を設定します。");

// マルチ選択モード
        var pm = pageSettings.add("panel", undefined, "複数レイヤー処理");
        pm.orientation   = "row";
        pm.alignChildren = "left";

        var rbEach = pm.add("radiobutton", undefined, "各レイヤーに1つずつ作成");
        var rbAll  = pm.add("radiobutton", undefined, "選択全体を囲う1つを作成");

        var multiDef = DEFAULT_UI.multiMode;
        rbAll.value  = (multiDef === "all");
        rbEach.value = !rbAll.value;

        // チェックの既定値
        ckInsertAbove.value = DEFAULT_UI.insertAbove;
        ckAdj.value         = DEFAULT_UI.makeAdj;
        ckMatte.value       = DEFAULT_UI.setMatte;
        ckAllowAuto.value   = DEFAULT_UI.allowAuto;

        var presets = loadPresets();
        var presetPanel = pageSettings.add("panel", undefined, "プリセット");
        presetPanel.orientation = "row";
        presetPanel.alignChildren = "left";
        var ddPreset = presetPanel.add("dropdownlist", undefined, []);
        ddPreset.preferredSize = [220, 24];
        var btPresetSave = presetPanel.add("button", undefined, "Save");
        var btPresetLoad = presetPanel.add("button", undefined, "Load");
        var btPresetDelete = presetPanel.add("button", undefined, "Delete");

        function refreshPresetList(selectIndex) {
            ddPreset.removeAll();
            for (var i=0; i<presets.length; i++) ddPreset.add("item", presets[i].name || ("Preset_" + (i+1)));
            if (presets.length === 0) return;
            var idx = (typeof selectIndex === "number") ? selectIndex : (presets.length - 1);
            idx = Math.max(0, Math.min(presets.length - 1, idx));
            ddPreset.selection = idx;
        }

        function getCurrentUIValues() {
            return {
                padX: num(etPadX.text, DEFAULT_UI.padX),
                padY: num(etPadY.text, DEFAULT_UI.padY),
                corner: num(etCorner.text, DEFAULT_UI.corner),
                padUnit: ddPadUnit.selection ? ddPadUnit.selection.text : DEFAULT_UI.padUnit,
                includeExt: !!ckExt.value,
                strokeOn: !!ckStroke.value,
                strokeW: num(etStrokeW.text, DEFAULT_UI.strokeW),
                fillOn: !!ckFill.value,
                strokeColor: strokeSwatch.getColor(),
                fillColor: fillSwatch.getColor(),
                shapeLabel: ddLabelColor.selection ? ddLabelColor.selection.index : DEFAULT_UI.shapeLabel,
                bracketOn: !!ckBracket.value,
                bracketLen: num(etBracketLen.text, DEFAULT_UI.bracketLen),
                bracketStyle: ddBracketStyle.selection ? ddBracketStyle.selection.index : DEFAULT_UI.bracketStyle,
                bracketLT: !!ckBrLT.value,
                bracketRT: !!ckBrRT.value,
                bracketLB: !!ckBrLB.value,
                bracketRB: !!ckBrRB.value,
                bracketStrokeW: num(etBracketStroke.text, DEFAULT_UI.bracketStrokeW),
                bracketStrokeColor: brColorSwatch.getColor(),
                sideLineOn: !!ckSideLine.value,
                sideLineTop: !!ckSideTop.value,
                sideLineBottom: !!ckSideBottom.value,
                sideLineLeft: !!ckSideLeft.value,
                sideLineRight: !!ckSideRight.value,
                sideLineStrokeW: num(etSideLineStroke.text, DEFAULT_UI.sideLineStrokeW),
                sideLineStrokeColor: sideColorSwatch.getColor(),
                multiMode: rbAll.value ? "all" : "each",
                insertAbove: !!ckInsertAbove.value,
                makeAdj: !!ckAdj.value,
                setMatte: !!ckMatte.value,
                allowAuto: !!ckAllowAuto.value
            };
        }

        // ツールチップ
        btCreate.helpTip = "現在の選択レイヤーに追従するAutoRectを作成します。";
        btLockPad.helpTip = "選択中のAutoRectの追従を停止し、現在の見た目で固定します。";
        btUnlockPad.helpTip = "選択中のAutoRectの追従を復活します。";
        btApplyFollow.helpTip = "各レイヤーの『文字追従 有効』チェックを読み取り、ON=追従復活 / OFF=追従停止 を適用します。";
        btCopyParams.helpTip = "複数選択時、最後に選択したAutoRectの設定・アニメーションを他へコピーします。";
        btBake.helpTip = "選択中のAutoRect式を現在時刻の値で焼き付け固定します。";

        ckInsertAbove.helpTip = "ONで対象レイヤーの上に矩形を作成します（Shiftで一時反転）。";
        ckAdj.helpTip = "作成した矩形を調整レイヤーにします。";
        ckMatte.helpTip = "対象にアルファトラックマットを設定します。";
        ckAllowAuto.helpTip = "既存Rect_があっても新規作成を許可します。";

        padXRow.row.helpTip = "左右余白です。"; padXRow.edit.helpTip = padXRow.slider.helpTip = "左右余白(pxまたは%)。";
        padYRow.row.helpTip = "上下余白です。"; padYRow.edit.helpTip = padYRow.slider.helpTip = "上下余白(pxまたは%)。";
        cornerRow.row.helpTip = "角丸半径です。"; cornerRow.edit.helpTip = cornerRow.slider.helpTip = "角丸(0-100)。";
        ddPadUnit.helpTip = "余白の単位を px / % で切り替えます。";
        ckExt.helpTip = "段落テキストの拡張境界も矩形計算に含めます。";
        ckStroke.helpTip = "矩形の線表示をON/OFFします。";
        etStrokeW.helpTip = slStrokeW.helpTip = "線幅です。";
        ckFill.helpTip = "矩形の塗り表示をON/OFFします。";
        ddLabelColor.helpTip = "作成するシェイプレイヤーのラベル色です（既定: 9）。";

        ckBracket.helpTip = "コーナーブラケットの表示ON/OFF。";
        etBracketLen.helpTip = slBracketLen.helpTip = "ブラケットの長さ。";
        ddBracketStyle.helpTip = "内向き / 外向き を切替。";
        ckBrLT.helpTip = "左上ブラケットを表示。";
        ckBrRT.helpTip = "右上ブラケットを表示。";
        ckBrLB.helpTip = "左下ブラケットを表示。";
        ckBrRB.helpTip = "右下ブラケットを表示。";
        etBracketStroke.helpTip = slBracketStroke.helpTip = "ブラケット線幅。";

        ckSideLine.helpTip = "サイドラインの表示ON/OFF。";
        ckSideTop.helpTip = "上辺ラインを表示。";
        ckSideBottom.helpTip = "下辺ラインを表示。";
        ckSideLeft.helpTip = "左辺ラインを表示。";
        ckSideRight.helpTip = "右辺ラインを表示。";
        etSideLineStroke.helpTip = slSideLineStroke.helpTip = "サイドライン線幅。";

        rbEach.helpTip = "各選択レイヤーごとに1つずつ作成。";
        rbAll.helpTip = "選択全体を囲う1つを作成。";

        // 選択情報更新
        function refreshInfo(){
            var comp = app.project && app.project.activeItem;
            if (!comp || !(comp instanceof CompItem)) {
                selTxt.text  = "コンポをアクティブにしてください。";
                warnTxt.text = "";
                return;
            }
            var sel = comp.selectedLayers;
            if (!sel || sel.length === 0) {
                selTxt.text  = "選択：なし";
                warnTxt.text = "テキストやフッテージ等のレイヤーを選択してください。";
                return;
            }
            var countText=0, countShape=0, countOther=0;
            for (var i=0;i<sel.length;i++){
                var L = sel[i];
                if (L instanceof TextLayer)      countText++;
                else if (L instanceof ShapeLayer) countShape++;
                else                             countOther++;
            }
            selTxt.text = "選択：" + sel.length +
                          "  [テキスト:"+countText+
                          " / シェイプ:"+countShape+
                          " / その他:"+countOther+"]";
            warnTxt.text = "";
        }

        pal.onShow = refreshInfo;
        pal.addEventListener("mousemove", refreshInfo);

        function bindSlider(editText, slider, minVal, maxVal) {
            function syncFromEdit() {
                var v = clamp(num(editText.text, minVal), minVal, maxVal);
                slider.value = v;
                editText.text = String(v);
            }
            function syncFromSlider() {
                editText.text = String(Math.round(slider.value * 10) / 10);
            }
            editText.onChange = syncFromEdit;
            slider.onChanging = syncFromSlider;
            syncFromEdit();
            return syncFromEdit;
        }

        var syncPadX = bindSlider(padXRow.edit, padXRow.slider, 0, 300);
        var syncPadY = bindSlider(padYRow.edit, padYRow.slider, 0, 300);
        var syncCorner = bindSlider(cornerRow.edit, cornerRow.slider, 0, 100);
        var syncStrokeW = bindSlider(etStrokeW, slStrokeW, 0, 50);
        var syncBracketLen = bindSlider(etBracketLen, slBracketLen, 0, 300);
        var syncBracketStroke = bindSlider(etBracketStroke, slBracketStroke, 0, 50);
        var syncSideStroke = bindSlider(etSideLineStroke, slSideLineStroke, 0, 50);

        function applyUIValues(v) {
            if (!v) return;
            etPadX.text = String(num(v.padX, DEFAULT_UI.padX)); syncPadX();
            etPadY.text = String(num(v.padY, DEFAULT_UI.padY)); syncPadY();
            etCorner.text = String(num(v.corner, DEFAULT_UI.corner)); syncCorner();
            ddPadUnit.selection = (String(v.padUnit || DEFAULT_UI.padUnit) === "%") ? 1 : 0;
            ckExt.value = !!v.includeExt;
            ckStroke.value = !!v.strokeOn;
            etStrokeW.text = String(num(v.strokeW, DEFAULT_UI.strokeW)); syncStrokeW();
            ckFill.value = !!v.fillOn;
            strokeSwatch.setColor(v.strokeColor || DEFAULT_UI.strokeColor);
            fillSwatch.setColor(v.fillColor || DEFAULT_UI.fillColor);
            var lb = clamp(Math.round(num(v.shapeLabel, DEFAULT_UI.shapeLabel)), 0, 16);
            ddLabelColor.selection = lb;

            ckBracket.value = !!v.bracketOn;
            etBracketLen.text = String(num(v.bracketLen, DEFAULT_UI.bracketLen)); syncBracketLen();
            ddBracketStyle.selection = (num(v.bracketStyle, DEFAULT_UI.bracketStyle) >= 1) ? 1 : 0;
            ckBrLT.value = !!v.bracketLT;
            ckBrRT.value = !!v.bracketRT;
            ckBrLB.value = !!v.bracketLB;
            ckBrRB.value = !!v.bracketRB;
            etBracketStroke.text = String(num(v.bracketStrokeW, DEFAULT_UI.bracketStrokeW)); syncBracketStroke();
            brColorSwatch.setColor(v.bracketStrokeColor || DEFAULT_UI.bracketStrokeColor);

            ckSideLine.value = !!v.sideLineOn;
            ckSideTop.value = !!v.sideLineTop;
            ckSideBottom.value = !!v.sideLineBottom;
            ckSideLeft.value = !!v.sideLineLeft;
            ckSideRight.value = !!v.sideLineRight;
            etSideLineStroke.text = String(num(v.sideLineStrokeW, DEFAULT_UI.sideLineStrokeW)); syncSideStroke();
            sideColorSwatch.setColor(v.sideLineStrokeColor || DEFAULT_UI.sideLineStrokeColor);

            rbAll.value = String(v.multiMode || DEFAULT_UI.multiMode) === "all";
            rbEach.value = !rbAll.value;
            ckInsertAbove.value = !!v.insertAbove;
            ckAdj.value = !!v.makeAdj;
            ckMatte.value = !!v.setMatte;
            ckAllowAuto.value = !!v.allowAuto;
        }

        refreshPresetList();

        btPresetSave.onClick = function() {
            var nm = prompt("プリセット名", "Preset_" + (presets.length + 1));
            if (nm === null) return;
            nm = String(nm).replace(/^\s+|\s+$/g, "");
            if (nm === "") nm = "Preset_" + (presets.length + 1);
            var values = getCurrentUIValues();
            var replaced = false;
            for (var i=0; i<presets.length; i++) {
                if (presets[i].name === nm) {
                    presets[i].values = values;
                    replaced = true;
                    refreshPresetList(i);
                    break;
                }
            }
            if (!replaced) {
                presets.push({name:nm, values:values});
                refreshPresetList(presets.length - 1);
            }
            if (!savePresets(presets)) alert("プリセットの保存に失敗しました。");
        };

        btPresetLoad.onClick = function() {
            var idx = ddPreset.selection ? ddPreset.selection.index : -1;
            if (idx < 0 || idx >= presets.length) {
                alert("読み込むプリセットを選択してください。");
                return;
            }
            applyUIValues(presets[idx].values || {});
        };

        btPresetDelete.onClick = function() {
            var idx = ddPreset.selection ? ddPreset.selection.index : -1;
            if (idx < 0 || idx >= presets.length) {
                alert("削除するプリセットを選択してください。");
                return;
            }
            presets.splice(idx, 1);
            refreshPresetList(Math.max(0, idx - 1));
            if (!savePresets(presets)) alert("プリセットの保存に失敗しました。");
        };

        function gatherOptions(){
            var padX   = num(etPadX.text, 16);
            var padY   = num(etPadY.text, 8);
            var corner = clamp(num(etCorner.text, 0), 0, 100);
            var strokeW = Math.max(0, num(etStrokeW.text, 4));
            var bracketOn = ckBracket.value;
            var bracketLen = num(etBracketLen.text, 24);
            var bracketStyle = ddBracketStyle.selection ? ddBracketStyle.selection.index : 0;
            var bracketCorners = {lt: ckBrLT.value, rt: ckBrRT.value, lb: ckBrLB.value, rb: ckBrRB.value};
            var bracketStrokeW = Math.max(0, num(etBracketStroke.text, 4));
            var sideLineOn = ckSideLine.value;
            var sideLineSides = {
                top: ckSideTop.value,
                bottom: ckSideBottom.value,
                left: ckSideLeft.value,
                right: ckSideRight.value
            };
            var sideLineShrink = {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0
            };
            var sideLineStrokeW = Math.max(0, num(etSideLineStroke.text, 4));
            var padUnit = ddPadUnit.selection ? ddPadUnit.selection.text : "px";
            var usePct = (padUnit === "%");
            var shrinkX = 0;
            var shrinkY = 0;
            var strokeC = strokeSwatch.getColor();
            var fillC   = fillSwatch.getColor();
            var brStrokeC = brColorSwatch.getColor();
            var sideStrokeC = sideColorSwatch.getColor();
            var shapeLabel = ddLabelColor.selection ? ddLabelColor.selection.index : 9;

            return {
                insertAbove:   ckInsertAbove.value,
                makeAdjustment:ckAdj.value,
                setTrackMatte: ckMatte.value,
                includeExtents:ckExt.value,
                paddingX:      padX,
                paddingY:      padY,
                cornerRadius:  corner,
                paddingUnit:   padUnit,
                usePaddingPercent: usePct,
                shrinkX:       shrinkX,
                shrinkY:       shrinkY,
                bracketOn:     bracketOn,
                bracketLength: bracketLen,
                bracketStyle:  bracketStyle,
                bracketCorners: bracketCorners,
                bracketStrokeWidth: bracketStrokeW,
                bracketStrokeColor: brStrokeC,
                sideLineOn:    sideLineOn,
                sideLineSides: sideLineSides,
                sideLineShrink: sideLineShrink,
                sideLineStrokeWidth: sideLineStrokeW,
                sideLineStrokeColor: sideStrokeC,
                strokeOn:      ckStroke.value,
                strokeWidth:   strokeW,
                strokeColor:   strokeC,
                fillOn:        ckFill.value,
                fillColor:     fillC,
                shapeLabel:    shapeLabel,
                multiMode:     (rbAll.value ? "all" : "each"),
                allowAutoOnAuto: ckAllowAuto.value
            };
        }

        // -----------------------------
        // ボタン動作
        // -----------------------------
        btCreate.onClick = function(){
            app.beginUndoGroup(SCRIPT_NAME + " - 作成");
            try {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) {
                    alert("コンポジションをアクティブにしてください。");
                    return;
                }

                var sel = comp.selectedLayers;
                if (!sel || sel.length === 0) {
                    alert("テキストレイヤーなどを選択してから実行してください。");
                    return;
                }

                // 対象：sourceRectAtTime を持つレイヤーのみ
                var targets = [];
                for (var i=0;i<sel.length;i++){
                    var L = sel[i];
                    if (!L) continue;
                    if (!L.sourceRectAtTime) continue;   // カメラ/ライト/ヌルなどはここで落ちる
                    targets.push(L);
                }

                if (targets.length === 0) {
                    alert("対象レイヤー（テキスト／フッテージ等）が見つかりません。");
                    return;
                }

                var opt = gatherOptions();

                // allowAutoOnAuto が OFF のとき、
                // すでに Rect_ が付いたレイヤーはスキップ
                if (!opt.allowAutoOnAuto && opt.multiMode === "each") {
                    var filtered = [];
                    for (var i2=0;i2<targets.length;i2++){
                        var t = targets[i2];
                        var base = "Rect_" + t.name;
                        var exists = false;
                        for (var li=1; li<=comp.numLayers; li++){
                            if (comp.layer(li).name.indexOf(base) === 0) {
                                exists = true; break;
                            }
                        }
                        if (!exists) filtered.push(t);
                    }
                    targets = filtered;
                    if (targets.length === 0) {
                        alert("すでに矩形が存在するため、新規作成する対象がありません。\n「重複許可」をONにすると上書き作成できます。");
                        return;
                    }
                }

                var created = [];
                try {
                    created = createAutoRectForTargets(comp, targets, opt);
                } catch(err) {
                    alert("作成中にエラーが発生しました: " + err.toString());
                }

                // 万一作成数が 0 の場合は、ブラケットなしでリトライ
                if (created.length === 0 && targets.length > 0) {
                    var fallbackOpt = {};
                    for (var k in opt) if (opt.hasOwnProperty(k)) fallbackOpt[k] = opt[k];
                    fallbackOpt.bracketOn = false;
                    try {
                        created = createAutoRectForTargets(comp, targets, fallbackOpt);
                    } catch(err2) {
                        alert("作成リトライ時にエラーが発生しました: " + err2.toString());
                    }
                }

                if (created.length === 0) {
                    // さらに最後の保険として、最初のターゲットに簡易矩形を作成
                    try {
                        var t0 = targets[0];
                        var simple = comp.layers.addShape();
                        simple.name = uniqueNameInComp(comp, "Rect_" + t0.name);
                        simple.threeDLayer = t0.threeDLayer;
                        try { simple.label = opt.shapeLabel; } catch(eLabelSimple) {}
                        var cts = simple.property("Contents");
                        var g = cts.addProperty("ADBE Vector Group");
                        g.name = "AutoRect";
                        var r = g.property("Contents").addProperty("ADBE Vector Shape - Rect");
                        r.property("Size").setValue([100,50]);
                        r.property("Position").setValue([0,0]);
                        ensureStrokeFill(g, {
                            strokeOn:true, strokeWidth:4, strokeColor:[0.2,0.6,1],
                            fillOn:false
                        });
                        simple.moveBefore(t0);
                        created.push({shape:simple, target:t0});
                    } catch(eSimple) {
                        alert("何も作成されませんでした。最後の保険でも作成できませんでした: " + eSimple.toString());
                    }
                }

                if (created.length === 0) {
                    alert("何も作成されませんでした。");
                } else {
                    // 作成後は元のターゲットを再選択
                    for (var i3=0;i3<targets.length;i3++) targets[i3].selected = true;
                }

            } finally {
                app.endUndoGroup();
                refreshInfo();
            }
        };

        btLockPad.onClick = function(){
            app.beginUndoGroup(SCRIPT_NAME + " - 文字追従停止");
            try {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) {
                    alert("コンポジションをアクティブにしてください。");
                    return;
                }
                var cand = pickCandidateShapesFromSelection(comp);
                if (cand.length === 0) {
                    alert("文字追従停止の対象となる矩形レイヤーを選択してください。");
                    return;
                }
                lockWithPadding(cand, comp.time);
            } finally {
                app.endUndoGroup();
            }
        };

        btUnlockPad.onClick = function(){
            app.beginUndoGroup(SCRIPT_NAME + " - 文字追従復活");
            try {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) {
                    alert("コンポジションをアクティブにしてください。");
                    return;
                }
                var cand = pickCandidateShapesFromSelection(comp);
                if (cand.length === 0) {
                    alert("文字追従復活の対象となる矩形レイヤーを選択してください。");
                    return;
                }

                unlockPadding(cand, comp);
            } finally {
                app.endUndoGroup();
            }
        };

        btApplyFollow.onClick = function(){
            app.beginUndoGroup(SCRIPT_NAME + " - 追従チェック反映");
            try {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) {
                    alert("コンポジションをアクティブにしてください。");
                    return;
                }
                var cand = pickCandidateShapesFromSelection(comp);
                if (cand.length === 0) {
                    alert("追従チェック反映の対象となる矩形レイヤーを選択してください。");
                    return;
                }
                applyFollowStateFromEffects(cand, comp, comp.time);
            } finally {
                app.endUndoGroup();
            }
        };

        btCopyParams.onClick = function(){
            app.beginUndoGroup(SCRIPT_NAME + " - 設定コピー");
            try {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) {
                    alert("コンポジションをアクティブにしてください。");
                    return;
                }
                var cand = pickCandidateShapesFromSelection(comp);
                if (!cand || cand.length < 2) {
                    alert("2つ以上の矩形レイヤーを選択してください。\n最後に選択したレイヤーの設定を他へ反映します。");
                    return;
                }
                var src = cand[cand.length - 1];
                var dst = [];
                for (var i=0;i<cand.length;i++) {
                    if (cand[i] !== src) dst.push(cand[i]);
                }
                syncAutoRectParamsFromSource(src, dst);
            } finally {
                app.endUndoGroup();
            }
        };

        btBake.onClick = function(){
            app.beginUndoGroup(SCRIPT_NAME + " - Bake");
            try {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) {
                    alert("コンポジションをアクティブにしてください。");
                    return;
                }

                // ★選択レイヤーそのもの
                var sel  = comp.selectedLayers;
                // ★Bake 対象としてスクリプトが認識しているシェイプレイヤー
                var cand = pickCandidateShapesFromSelection(comp);

                if (cand.length === 0) {
                    alert("Bake 対象の矩形レイヤーを選択してください。");
                    return;
                }

                // ---- ここで実際に Bake ----
                bakeLayers(cand, comp.time);

            } finally {
                app.endUndoGroup();
            }
        };


        pal.layout.layout(true);
        pal.onResizing = pal.onResize = function () { this.layout.resize(); };

        if (pal instanceof Window) {
            pal.onClose = function () {
                clearWindowSingleton(this);
                return true;
            };
        }

        return pal;
    }

    // -----------------------------
    // エントリポイント（UI 起動）
    // -----------------------------
    var existingWin = (thisObj instanceof Panel) ? null : getExistingWindowSingleton();
    if (existingWin) {
        try {
            existingWin.show();
            existingWin.active = true;
        } catch (eShowAgain) {}
        return;
    }

    var ui = buildUI(thisObj);
    if (ui instanceof Window) {
        storeWindowSingleton(ui);
        ui.center();
        ui.show();
    }

})(this);
