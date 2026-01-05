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
    var SET_NS      = "AutoRectUI_v1";
    var MATTE_TYPE  = TrackMatteType.ALPHA;

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

    function createColorSwatch(parent, label, initialRGB) {
        var grp = parent.add("group");
        grp.orientation = "row";
        grp.add("statictext", undefined, label);
        var sw = grp.add("button", undefined, "");
        sw.preferredSize = [40, 20];
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

    function saveSetting(key, val){
        try { app.settings.saveSetting(SET_NS, key, String(val)); } catch(e){}
    }
    function loadSetting(key, def){
        try {
            if (app.settings.haveSetting(SET_NS, key)) {
                var v = app.settings.getSetting(SET_NS, key);
                if (v === "true")  return true;
                if (v === "false") return false;
                var f = parseFloat(v);
                return (isFinite(f) && String(f) === v) ? f : v;
            }
        } catch(e){}
        return def;
    }

    // -----------------------------
    // エクスプレッション生成
    // -----------------------------
    function buildLayerRectDataFunc(includeExtentsStr) {
        var s = "";
        s += "function layerRectData(L){\n";
        s += "  var r = L.sourceRectAtTime(time,"+includeExtentsStr+");\n";
        s += "  var p1 = L.toComp([r.left, r.top]);\n";
        s += "  var p2 = L.toComp([r.left + r.width, r.top + r.height]);\n";
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
        s += "        var q1 = L.toComp(sL.toComp([rr.left, rr.top]));\n";
        s += "        var q2 = L.toComp(sL.toComp([rr.left + rr.width, rr.top + rr.height]));\n";
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
        s += "function toLayer(pt){ return fromComp(pt); }\n";
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
            s += "  fromComp(L.toComp([cx, cy]));\n";
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
            s += "  fromComp(L.toComp([cx, cy]));\n";
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
        s += "function toLayer(pt){ return fromComp(pt); }\n";
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
        s += "    fromComp(L.toComp(cornerLayer));\n";
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
        s += "    fromComp(L.toComp(cornerLayer));\n";
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
        s += "function toLayer(pt){ return fromComp(pt); }\n";
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
        s += "    fromComp(L.toComp(" + sidePoint + "));\n";
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
        s += "    fromComp(L.toComp(" + sidePoint + "));\n";
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

            if (option.parentTo) {
                shape.parent = topTgt;
                shape.transform.position.setValue(shape.threeDLayer ? [0,0,0] : [0,0]);
            } else {
                linkLayerTransformByExpr(shape, topTgt);
            }

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

                var contents = shape.property("Contents");
                var gp   = contents.addProperty("ADBE Vector Group");
                gp.name  = "AutoRect";
                var rect = gp.property("Contents").addProperty("ADBE Vector Shape - Rect");

                addPaddingAndCornerEffects(shape, option.paddingX, option.paddingY, option.cornerRadius, option.usePaddingPercent);
                addBracketEffects(shape, option);
                addSideLineEffects(shape, option);

                var useParentMode = option.parentTo;
                var modeName = useParentMode ? "parent" : "direct";
                rect.property("Size").expression      = buildRectSizeExpr(modeName, [tgt.name], option.includeExtents, option.shrinkX, option.shrinkY);
                rect.property("Position").expression  = buildRectPosExpr(modeName, [tgt.name], option.includeExtents, option.shrinkX, option.shrinkY);
                if (!useParentMode) {
                    linkLayerTransformByExpr(shape, tgt);
                }
                rect.property("Roundness").expression = buildRoundnessExpr();

                ensureStrokeFill(gp, option);
                addCornerBrackets(shape, modeName, [tgt.name], option, option.includeExtents);
                addSideLines(shape, modeName, [tgt.name], option, option.includeExtents);

                if (useParentMode) {
                    shape.parent = tgt;
                    shape.transform.position.setValue(shape.threeDLayer ? [0,0,0] : [0,0]);
                }

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

            // 親子付けモードっぽいかどうか（親＝ターゲットなら parent モード）
            var mode = (L.parent === target) ? "parent" : "direct";

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

            // 固定ベース用エフェクトがあってもそのまま残す（現状は使っていない）
        }
    }





    // -----------------------------
    // UI 構築
    // -----------------------------
    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, {resizeable:true});

        // 上部：選択情報
        var infoGrp = pal.add("group");
        infoGrp.orientation = "column";
        infoGrp.alignChildren = "left";

        var selTxt  = infoGrp.add("statictext", undefined, "選択：なし");
        selTxt.characters = 40;
        var warnTxt = infoGrp.add("statictext", undefined, "");
        warnTxt.characters = 40;

        // メインボタン
        var btnGrp = pal.add("group");
        btnGrp.alignment = "fill";
        var btCreate   = btnGrp.add("button", undefined, "作成 (Create)");
        var btLockPad  = btnGrp.add("button", undefined, "文字追従停止");
        var btUnlockPad = btnGrp.add("button", undefined, "文字追従復活");
        var btBake     = btnGrp.add("button", undefined, "Bake 固定化");

        // スイッチ列
        var sw = pal.add("group");
        sw.orientation = "row";
        sw.alignment   = "fill";
        var ckInsertAbove = sw.add("checkbox", undefined, "上に挿入");
        var ckParent      = sw.add("checkbox", undefined, "ターゲットに親子付け");
        var ckAdj         = sw.add("checkbox", undefined, "調整レイヤーにする");
        var ckMatte       = sw.add("checkbox", undefined, "トラックマット(アルファ)");
        var ckAllowAuto   = sw.add("checkbox", undefined, "重複許可");

        // オプション
        var opt = pal.add("panel", undefined, "オプション");
        opt.orientation = "column";
        opt.alignChildren = "left";
        opt.alignment = "fill";

        function addSliderRow(parent, label, settingKey, defVal, minVal, maxVal, chars) {
            var row = parent.add("group");
            row.add("statictext", undefined, label);
            var et = row.add("edittext", undefined, String(loadSetting(settingKey, defVal)));
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
        var padUnitDef = String(loadSetting("padUnit", "px"));
        ddPadUnit.selection = (padUnitDef === "%") ? 1 : 0;

        var row2 = opt.add("group");
        var ckExt = row2.add("checkbox", undefined, "段落テキストの拡張境界を含める（Include Extents）");
        ckExt.value = !!loadSetting("includeExt", true);

        var row3 = opt.add("group");
        var ckStroke = row3.add("checkbox", undefined, "線（Stroke）");
        ckStroke.value = !!loadSetting("strokeOn", true);
        var strokeRow = addSliderRow(opt, "線幅", "strokeW", 4, 0, 50, 4);
        var etStrokeW = strokeRow.edit;
        var slStrokeW = strokeRow.slider;

        var row4 = opt.add("group");
        var ckFill = row4.add("checkbox", undefined, "塗り（Fill）");
        ckFill.value = !!loadSetting("fillOn", true);

        var strokeSwatch = createColorSwatch(row4, "線色", [
            loadSetting("strokeR", 0.2),
            loadSetting("strokeG", 0.6),
            loadSetting("strokeB", 1.0)
        ]);
        var fillSwatch = createColorSwatch(row4, "塗り色", [
            loadSetting("fillR", 0.0),
            loadSetting("fillG", 0.4),
            loadSetting("fillB", 0.9)
        ]);

        var brPanel = opt.add("panel", undefined, "コーナーブラケット");
        brPanel.orientation = "column";
        brPanel.alignChildren = "left";
        var brTop = brPanel.add("group");
        var ckBracket = brTop.add("checkbox", undefined, "コーナーブラケット");
        ckBracket.value = !!loadSetting("bracketOn", false);
        var brLenRow = addSliderRow(brPanel, "長さ", "bracketLen", 24, 0, 300, 5);
        var etBracketLen = brLenRow.edit;
        var slBracketLen = brLenRow.slider;
        var brStyleRow = brPanel.add("group");
        brStyleRow.add("statictext", undefined, "スタイル");
        var ddBracketStyle = brStyleRow.add("dropdownlist", undefined, ["内向き","外向き"]);
        var brStyleDef = num(loadSetting("bracketStyle", 0), 0);
        ddBracketStyle.selection = (brStyleDef >= 1) ? 1 : 0;

        var brRow = brPanel.add("group");
        brRow.add("statictext", undefined, "角:");
        var ckBrLT = brRow.add("checkbox", undefined, "左上");
        var ckBrRT = brRow.add("checkbox", undefined, "右上");
        var ckBrLB = brRow.add("checkbox", undefined, "左下");
        var ckBrRB = brRow.add("checkbox", undefined, "右下");
        ckBrLT.value = !!loadSetting("bracketLT", true);
        ckBrRT.value = !!loadSetting("bracketRT", true);
        ckBrLB.value = !!loadSetting("bracketLB", true);
        ckBrRB.value = !!loadSetting("bracketRB", true);
        var brStrokeRow = addSliderRow(brPanel, "線幅", "bracketStrokeW", 4, 0, 50, 4);
        var etBracketStroke = brStrokeRow.edit;
        var slBracketStroke = brStrokeRow.slider;
        var brColorSwatch = createColorSwatch(brStrokeRow.row, "線色", [
            loadSetting("bracketStrokeR", 0.2),
            loadSetting("bracketStrokeG", 0.6),
            loadSetting("bracketStrokeB", 1.0)
        ]);

        var sidePanel = opt.add("panel", undefined, "サイドライン");
        sidePanel.orientation = "column";
        sidePanel.alignChildren = "left";
        var sideTop = sidePanel.add("group");
        var ckSideLine = sideTop.add("checkbox", undefined, "サイドライン");
        ckSideLine.value = !!loadSetting("sideLineOn", false);

        var sideRow = sidePanel.add("group");
        sideRow.add("statictext", undefined, "方向:");
        var ckSideTop = sideRow.add("checkbox", undefined, "上");
        var ckSideBottom = sideRow.add("checkbox", undefined, "下");
        var ckSideLeft = sideRow.add("checkbox", undefined, "左");
        var ckSideRight = sideRow.add("checkbox", undefined, "右");
        ckSideTop.value = !!loadSetting("sideLineTop", true);
        ckSideBottom.value = !!loadSetting("sideLineBottom", true);
        ckSideLeft.value = !!loadSetting("sideLineLeft", true);
        ckSideRight.value = !!loadSetting("sideLineRight", true);

        var sideStrokeRow = addSliderRow(sidePanel, "線幅", "sideLineStrokeW", 4, 0, 50, 4);
        var etSideLineStroke = sideStrokeRow.edit;
        var slSideLineStroke = sideStrokeRow.slider;
        var sideColorSwatch = createColorSwatch(sideStrokeRow.row, "線色", [
            loadSetting("sideLineStrokeR", 0.2),
            loadSetting("sideLineStrokeG", 0.6),
            loadSetting("sideLineStrokeB", 1.0)
        ]);

// マルチ選択モード
        var pm = pal.add("panel", undefined, "複数レイヤー処理");
        pm.orientation   = "row";
        pm.alignChildren = "left";

        var rbEach = pm.add("radiobutton", undefined, "各レイヤーに1つずつ作成");
        var rbAll  = pm.add("radiobutton", undefined, "選択全体を囲う1つを作成");

        var multiDef = String(loadSetting("multiMode", "each"));
        rbAll.value  = (multiDef === "all");
        rbEach.value = !rbAll.value;

        // チェックの既定値
        ckInsertAbove.value = !!loadSetting("insertAbove", false);
        ckParent.value      = !!loadSetting("parentTo",  true);
        ckAdj.value         = !!loadSetting("makeAdj",   false);
        ckMatte.value       = !!loadSetting("setMatte",  false);
        ckAllowAuto.value   = !!loadSetting("allowAuto", true);

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
        }

        bindSlider(padXRow.edit, padXRow.slider, 0, 300);
        bindSlider(padYRow.edit, padYRow.slider, 0, 300);
        bindSlider(cornerRow.edit, cornerRow.slider, 0, 100);
        bindSlider(etStrokeW, slStrokeW, 0, 50);
        bindSlider(etBracketLen, slBracketLen, 0, 300);
        bindSlider(etBracketStroke, slBracketStroke, 0, 50);
        bindSlider(etSideLineStroke, slSideLineStroke, 0, 50);

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
            saveSetting("padX", padX);
            saveSetting("padY", padY);
            saveSetting("corner", corner);
            saveSetting("padUnit", padUnit);
            saveSetting("includeExt", ckExt.value);
            saveSetting("strokeOn", ckStroke.value);
            saveSetting("strokeW", strokeW);
            saveSetting("fillOn", ckFill.value);
            saveSetting("bracketOn", bracketOn);
            saveSetting("bracketLen", bracketLen);
            saveSetting("bracketStyle", bracketStyle);
            saveSetting("bracketLT", ckBrLT.value);
            saveSetting("bracketRT", ckBrRT.value);
            saveSetting("bracketLB", ckBrLB.value);
            saveSetting("bracketRB", ckBrRB.value);
            saveSetting("bracketStrokeW", bracketStrokeW);
            var strokeC = strokeSwatch.getColor();
            var fillC   = fillSwatch.getColor();
            var brStrokeC = brColorSwatch.getColor();
            var sideStrokeC = sideColorSwatch.getColor();
            saveSetting("strokeR", strokeC[0]);
            saveSetting("strokeG", strokeC[1]);
            saveSetting("strokeB", strokeC[2]);
            saveSetting("fillR", fillC[0]);
            saveSetting("fillG", fillC[1]);
            saveSetting("fillB", fillC[2]);
            saveSetting("bracketStrokeR", brStrokeC[0]);
            saveSetting("bracketStrokeG", brStrokeC[1]);
            saveSetting("bracketStrokeB", brStrokeC[2]);
            saveSetting("sideLineOn", sideLineOn);
            saveSetting("sideLineTop", ckSideTop.value);
            saveSetting("sideLineBottom", ckSideBottom.value);
            saveSetting("sideLineLeft", ckSideLeft.value);
            saveSetting("sideLineRight", ckSideRight.value);
            saveSetting("sideLineStrokeW", sideLineStrokeW);
            saveSetting("sideLineStrokeR", sideStrokeC[0]);
            saveSetting("sideLineStrokeG", sideStrokeC[1]);
            saveSetting("sideLineStrokeB", sideStrokeC[2]);
            saveSetting("insertAbove", ckInsertAbove.value);
            saveSetting("parentTo", ckParent.value);
            saveSetting("makeAdj", ckAdj.value);
            saveSetting("setMatte", ckMatte.value);
            saveSetting("allowAuto", ckAllowAuto.value);
            saveSetting("multiMode", rbAll.value ? "all" : "each");

            return {
                insertAbove:   ckInsertAbove.value,
                parentTo:      ckParent.value,
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

                // 万一作成数が 0 の場合は、親子付けなし・ブラケットなしでリトライ
                if (created.length === 0 && targets.length > 0) {
                    var fallbackOpt = {};
                    for (var k in opt) if (opt.hasOwnProperty(k)) fallbackOpt[k] = opt[k];
                    fallbackOpt.parentTo = false;
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

        return pal;
    }

    // -----------------------------
    // エントリポイント（UI 起動）
    // -----------------------------
    var ui = buildUI(thisObj);
    if (ui instanceof Window) {
        ui.center();
        ui.show();
    }

})(this);
