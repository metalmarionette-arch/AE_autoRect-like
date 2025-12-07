/*==============================================================================
    オート矩形ツール（テキスト追従）修正版
    v1.0.4

    修正履歴:
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
        //     「上に作成」がON（insertAbove=true）の時だけ上に移動
        //     それ以外は元の位置のままにする
        if (!canUseLayerRefMatte) {
            // 古いトラックマット仕様: 必ず直上へ
            matteLayer.moveBefore(target);
        } else if (insertAbove) {
            // 新UIでも「上に作成」指定があるときだけ直上へ
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
    // mode: "parent" | "direct" | "multi"
    function buildRectSizeExpr(mode, targetNameList, includeExtents) {
        var inc = includeExtents ? "true" : "false";
        var s  = "";
        s += "var px = effect('余白 X')('スライダー');\n";
        s += "var py = effect('余白 Y')('スライダー');\n";

        if (mode === "parent") {
            s += "var L = parent;\n";
            s += "var r = L ? L.sourceRectAtTime(time,"+inc+") : {width:100,height:100};\n";
            s += "var w = Math.max(0, r.width  + px*2);\n";
            s += "var h = Math.max(0, r.height + py*2);\n";
            s += "[w, h];\n";

        } else if (mode === "direct") {
            s += "var L = thisComp.layer('"+ targetNameList[0].replace(/'/g,"\\'") +"');\n";
            s += "var r = L ? L.sourceRectAtTime(time,"+inc+") : {width:100,height:100};\n";
            s += "var w = Math.max(0, r.width  + px*2);\n";
            s += "var h = Math.max(0, r.height + py*2);\n";
            s += "[w, h];\n";

        } else { // multi
            s += "var names = [\n";
            for (var i=0;i<targetNameList.length;i++){
                s += "  '"+ targetNameList[i].replace(/'/g,"\\'") +"'" + (i<targetNameList.length-1 ? ",\n" : "\n");
            }
            s += "];\n";
            s += "function layerRect(L){\n";
            s += "  var r = L.sourceRectAtTime(time,"+inc+");\n";
            s += "  var p1 = L.toComp([r.left, r.top]);\n";
            s += "  var p2 = L.toComp([r.left + r.width, r.top + r.height]);\n";
            s += "  return [p1[0], p1[1], p2[0], p2[1]];\n";
            s += "}\n";
            s += "var l=1e9,t=1e9,r=-1e9,b=-1e9;\n";
            s += "for (var i=0;i<names.length;i++){\n";
            s += "  var L = thisComp.layer(names[i]);\n";
            s += "  if(!L) continue;\n";
            s += "  if (!L.sourceRectAtTime) continue;\n";
            s += "  var rc = layerRect(L);\n";
            s += "  l = Math.min(l, rc[0]);\n";
            s += "  t = Math.min(t, rc[1]);\n";
            s += "  r = Math.max(r, rc[2]);\n";
            s += "  b = Math.max(b, rc[3]);\n";
            s += "}\n";
            s += "var w = Math.max(0, r - l) + px*2;\n";
            s += "var h = Math.max(0, b - t) + py*2;\n";
            s += "[w, h];\n";
        }
        return s;
    }

    function buildRectPosExpr(mode, targetNameList, includeExtents) {
        var inc = includeExtents ? "true" : "false";
        var s  = "";

        if (mode === "parent") {
            s += "var L = parent;\n";
            s += "if (L){\n";
            s += "  var r = L.sourceRectAtTime(time,"+inc+");\n";
            s += "  // テキストのバウンディングの中心をコンポ座標に変換\n";
            s += "  var c = L.toComp([r.left + r.width/2, r.top + r.height/2]);\n";
            s += "  // それをシェイプレイヤーのローカル座標に戻して配置\n";
            s += "  fromWorld(c);\n";
            s += "}else{\n";
            s += "  [0,0];\n";
            s += "}\n";

        } else if (mode === "direct") {
            s += "var L = thisComp.layer('"+ targetNameList[0].replace(/'/g,"\\'") +"');\n";
            s += "if (L){\n";
            s += "  var r = L.sourceRectAtTime(time,"+inc+");\n";
            s += "  var c = L.toComp([r.left + r.width/2, r.top + r.height/2]);\n";
            s += "  fromWorld(c);\n";
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
            s += "  var r = L.sourceRectAtTime(time,"+inc+");\n";
            s += "  var p1 = L.toComp([r.left, r.top]);\n";
            s += "  var p2 = L.toComp([r.left + r.width, r.top + r.height]);\n";
            s += "  return [p1[0], p1[1], p2[0], p2[1]];\n";
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
            s += "var cx = (l+r)/2;\n";
            s += "var cy = (t+b)/2;\n";
            s += "fromWorld([cx,cy]);\n";
        }
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

        if (opt.strokeOn) {
            stroke = g.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Width").setValue(opt.strokeWidth);
            if (opt.strokeColor) stroke.property("ADBE Vector Stroke Color").setValue(opt.strokeColor);
        }
        if (opt.fillOn) {
            fill = g.addProperty("ADBE Vector Graphic - Fill");
            if (opt.fillColor) fill.property("ADBE Vector Fill Color").setValue(opt.fillColor);
        }
        return {stroke:stroke, fill:fill};
    }

    function addPaddingAndCornerEffects(layer, padX, padY, corner) {
        var fx = layer.property("ADBE Effect Parade");
        function addSlider(name, val){
            var sld = fx.addProperty("ADBE Slider Control");
            sld.name = name;
            sld.property("ADBE Slider Control-0001").setValue(val);
            return sld;
        }
        addSlider("余白 X", padX);
        addSlider("余白 Y", padY);
        addSlider("角丸", corner);
    }

    // ターゲット名をエクスプレッション経由で保持するためのエフェクトを追加
    function applyTargetReferenceEffect(shapeLayer, target) {
        if (!shapeLayer || !target) return;

        var fx = shapeLayer.property("ADBE Effect Parade");
        if (!fx) return;

        var ref = fx.property("ターゲット参照");
        if (!ref) {
            ref = fx.addProperty("ADBE Slider Control");
            if (!ref) return;
            ref.name = "ターゲット参照";
        }

        var prop = ref.property("ADBE Slider Control-0001");
        if (!prop || !prop.canSetExpression) return;

        // レイヤー名が変わっても自動追従するよう、レイヤー参照式を設定
        prop.expression = "thisComp.layer(\"" + target.name + "\").transform.position[0];";
        prop.expressionEnabled = true;
    }

    // "ターゲット参照" エフェクトのエクスプレッションから現在のレイヤー名を抽出
    function findTargetNameFromReferenceEffect(shapeLayer) {
        if (!shapeLayer) return null;
        var fx = shapeLayer.property("ADBE Effect Parade");
        if (!fx) return null;
        var ref = fx.property("ターゲット参照");
        if (!ref) return null;

        var prop = ref.property("ADBE Slider Control-0001");
        if (!prop) return null;

        var expr = String(prop.expression || "");
        var m = expr.match(/layer\(["'](.+?)["']\)/);
        return (m && m[1]) ? m[1] : null;
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

    function resetChildTransformForParent(shape) {
        if (!shape || !shape.transform) return;
        var tr = shape.transform;

        if (tr.rotation) tr.rotation.setValue(0);
        if (tr.zRotation) tr.zRotation.setValue(0);
        if (tr.xRotation) tr.xRotation.setValue(0);
        if (tr.yRotation) tr.yRotation.setValue(0);
        if (tr.orientation) tr.orientation.setValue([0, 0, 0]);

        if (tr.scale) {
            var sc = tr.scale.value;
            var base = (sc.length === 3) ? [100, 100, 100] : [100, 100];
            tr.scale.setValue(base);
        }
    }

    function createAutoRectForTargets(comp, targets, option) {
        var created = [];

        // multi=all のとき 2D/3D 混在なら警告
        if (option.multiMode === "all") {
            var has2D=false, has3D=false;
            for (var i=0;i<targets.length;i++){
                if (targets[i].threeDLayer) has3D=true; else has2D=true;
            }
            if (has2D && has3D) {
                alert("「選択全体を囲う1つ」モードで 2D/3D が混在しています。\n" +
                      "期待通りに見えない場合は「各レイヤーに1つずつ」を推奨します。");
            }
        }

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

            addPaddingAndCornerEffects(shape, option.paddingX, option.paddingY, option.cornerRadius);

            var names = [];
            for (var i=0;i<targets.length;i++) names.push(targets[i].name);

            rect.property("Size").expression      = buildRectSizeExpr("multi", names, option.includeExtents);
            rect.property("Position").expression  = buildRectPosExpr("multi", names, option.includeExtents);
            rect.property("Roundness").expression = buildRoundnessExpr();

            ensureStrokeFill(gp, option);

            applyTargetReferenceEffect(shape, topTgt);

            if (option.parentTo) {
                shape.parent = topTgt;
                shape.transform.position.setValue(shape.threeDLayer ? [0,0,0] : [0,0]);
                resetChildTransformForParent(shape);
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

                addPaddingAndCornerEffects(shape, option.paddingX, option.paddingY, option.cornerRadius);

                if (option.parentTo) {
                    rect.property("Size").expression      = buildRectSizeExpr("parent", [tgt.name], option.includeExtents);
                    rect.property("Position").expression  = buildRectPosExpr("parent", [tgt.name], option.includeExtents);
                } else {
                    rect.property("Size").expression      = buildRectSizeExpr("direct", [tgt.name], option.includeExtents);
                    rect.property("Position").expression  = buildRectPosExpr("direct", [tgt.name], option.includeExtents);
                    linkLayerTransformByExpr(shape, tgt);
                }
                rect.property("Roundness").expression = buildRoundnessExpr();

                ensureStrokeFill(gp, option);

                applyTargetReferenceEffect(shape, tgt);

                if (option.parentTo) {
                    shape.parent = tgt;
                    shape.transform.position.setValue(shape.threeDLayer ? [0,0,0] : [0,0]);
                    resetChildTransformForParent(shape);
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
                var isRect = (p.matchName === "ADBE Vector Rect Size" ||
                              p.matchName === "ADBE Vector Rect Position" ||
                              p.matchName === "ADBE Vector Rect Roundness");

                if (isRect || p.parentProperty === layer.transform) {
                    if (p.canSetExpression && p.expression !== "") {
                        callback(p);
                    }
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

            // このレイヤー内の Rect を取得
            var rects = getRectProps(L);
            if (!rects || rects.length === 0) continue;

            for (var j = 0; j < rects.length; j++) {
                var rectProp = rects[j];
                if (!rectProp) continue;

                var props = getRectSizePosRoundProps(rectProp);
                var sizeProp  = props.size;
                var posProp   = props.pos;
                var roundProp = props.round;

                // ---- Size を「固定ベース＋余白」に書き換え ----
                if (sizeProp) {
                    var szVal = sizeProp.valueAtTime(time, false); // 今の見た目 [w, h]
                    // テキストの素のサイズ（余白抜き）を固定ベースとする
                    var baseW = Math.max(0, szVal[0] - padX * 2);
                    var baseH = Math.max(0, szVal[1] - padY * 2);

                    // まず既存のエクスを殺して、今の見た目を書き戻し
                    sizeProp.expression = "";
                    sizeProp.expressionEnabled = false;
                    sizeProp.setValue([
                        Math.max(0, baseW + padX * 2),
                        Math.max(0, baseH + padY * 2)
                    ]);

                    // シンプルな式に差し替え（固定ベースは数値焼き込み）
                    var szExpr =
                        "var px = effect('余白 X')('スライダー');\n" +
                        "var py = effect('余白 Y')('スライダー');\n" +
                        "var bw = " + baseW.toFixed(4) + ";\n" +
                        "var bh = " + baseH.toFixed(4) + ";\n" +
                        "[Math.max(0, bw + px*2), Math.max(0, bh + py*2)];";

                    sizeProp.expression = szExpr;
                    sizeProp.expressionEnabled = true;
                }

                // ---- Position はその瞬間の値を固定値にするだけ ----
                if (posProp) {
                    var psVal = posProp.valueAtTime(time, false); // 今の見た目（中心位置）

                    posProp.expression = "";
                    posProp.expressionEnabled = false;
                    posProp.setValue(psVal);

                    var posExpr =
                        "[" + psVal[0].toFixed(4) + ", " +
                               psVal[1].toFixed(4) + "];";

                    posProp.expression = posExpr;
                    posProp.expressionEnabled = true;
                }

                // ---- Roundness は「角丸」スライダーに追従 ----
                if (roundProp) {
                    roundProp.expression = "";
                    roundProp.expressionEnabled = false;
                    roundProp.expression = buildRoundnessExpr();
                    roundProp.expressionEnabled = true;
                }
            }
        }
    }



    // AutoRect用のターゲットレイヤーを推定
    function findAutoRectTarget(comp, shapeLayer) {
        if (!comp || !shapeLayer) return null;

        var target = null;

        // 「ターゲット参照」エフェクトに埋めたレイヤー参照式から名前を復元
        var refName = findTargetNameFromReferenceEffect(shapeLayer);
        if (refName) {
            for (var ri = 1; ri <= comp.numLayers; ri++) {
                var rL = comp.layer(ri);
                if (rL && rL.name === refName && rL.sourceRectAtTime) {
                    target = rL;
                    break;
                }
            }
        }

        // 名前が "Rect_○○" の場合、○○ という名前のレイヤーを探す
        if (!target) {
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

            // 親子付けモードっぽいかどうか（親＝ターゲットなら parent モード）
            var mode = (L.parent === target) ? "parent" : "direct";

            // 段落テキスト拡張境界を含めるかは元情報が無いので、とりあえず true で復活
            var includeExtents = true;

            var rects = getRectProps(L);
            for (var j = 0; j < rects.length; j++) {
                var props = getRectSizePosRoundProps(rects[j]);

                // Size：元の AutoRect 式を再設定
                if (props.size) {
                    var szExpr = buildRectSizeExpr(mode, [target.name], includeExtents);
                    applyExpression(props.size, szExpr);
                }

                // Position：元の AutoRect 式を再設定
                if (props.pos) {
                    var posExpr = buildRectPosExpr(mode, [target.name], includeExtents);
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
        var ckInsertAbove = sw.add("checkbox", undefined, "上に作成（逆挿入）");
        var ckParent      = sw.add("checkbox", undefined, "ターゲットに親子付け");
        var ckAdj         = sw.add("checkbox", undefined, "調整レイヤーにする");
        var ckMatte       = sw.add("checkbox", undefined, "トラックマット(アルファ)");
        var ckAllowAuto   = sw.add("checkbox", undefined, "既存の枠にも再適用を許可");

        // オプション
        var opt = pal.add("panel", undefined, "オプション");
        opt.orientation = "column";
        opt.alignChildren = "left";
        opt.alignment = "fill";

        var row1 = opt.add("group");
        row1.add("statictext", undefined, "余白 X");
        var etPadX = row1.add("edittext", undefined, String(loadSetting("padX", 16)));
        etPadX.characters = 6;
        row1.add("statictext", undefined, "余白 Y");
        var etPadY = row1.add("edittext", undefined, String(loadSetting("padY", 8)));
        etPadY.characters = 6;
        row1.add("statictext", undefined, "角丸");
        var etCorner = row1.add("edittext", undefined, String(loadSetting("corner", 0)));
        etCorner.characters = 6;

        var row2 = opt.add("group");
        var ckExt = row2.add("checkbox", undefined, "段落テキストの拡張境界を含める（Include Extents）");
        ckExt.value = !!loadSetting("includeExt", true);

        var row3 = opt.add("group");
        var ckStroke = row3.add("checkbox", undefined, "線（Stroke）");
        ckStroke.value = !!loadSetting("strokeOn", true);
        row3.add("statictext", undefined, "線幅");
        var etStrokeW = row3.add("edittext", undefined, String(loadSetting("strokeW", 4)));
        etStrokeW.characters = 4;

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

        function gatherOptions(){
            var padX   = num(etPadX.text, 16);
            var padY   = num(etPadY.text, 8);
            var corner = clamp(num(etCorner.text, 0), 0, 100);
            var strokeW = Math.max(0, num(etStrokeW.text, 4));

            saveSetting("padX", padX);
            saveSetting("padY", padY);
            saveSetting("corner", corner);
            saveSetting("includeExt", ckExt.value);
            saveSetting("strokeOn", ckStroke.value);
            saveSetting("strokeW", strokeW);
            saveSetting("fillOn", ckFill.value);
            var strokeC = strokeSwatch.getColor();
            var fillC   = fillSwatch.getColor();
            saveSetting("strokeR", strokeC[0]);
            saveSetting("strokeG", strokeC[1]);
            saveSetting("strokeB", strokeC[2]);
            saveSetting("fillR", fillC[0]);
            saveSetting("fillG", fillC[1]);
            saveSetting("fillB", fillC[2]);
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
                        alert("すでに矩形が存在するため、新規作成する対象がありません。\n「既存の枠にも再適用を許可」をONにすると上書き作成できます。");
                        return;
                    }
                }

                var created = createAutoRectForTargets(comp, targets, opt);
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