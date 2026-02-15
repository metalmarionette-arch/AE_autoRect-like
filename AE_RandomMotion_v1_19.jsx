// RandomMotion - After Effects ScriptUI Panel
// AE 2024対応（ヘルプ機能：ツールチップ＆ステータスバー付き）

(function(thisObj) {
    "use strict";
    
    // ========================================
    // グローバル設定
    // ========================================
    var SCRIPT_NAME = "RandomMotion";
    var VERSION = "1.0.0";
    var PRESET_FILE = "RandomMotion_Presets.json"
    var UIREF = null; // UIコントロール参照を保持

    
    // デフォルト値
    // ★DEFAULT_VALUES を以下に置き換え
    var DEFAULT_VALUES = {
        // 位置（T）
        xMin: 0, xMax: 0,
        yMin: 0, yMax: 0,
        zMin: 0, zMax: 0,
        orderX: 0, orderY: 0, orderZ: 0, // 0:ランダム, 1:-+-+, 2:+-+-

        // 回転（3軸想定 R）
        rXMin: 0, rXMax: 0,
        rYMin: 0, rYMax: 0,
        rZMin: 0, rZMax: 0,
        orderRX: 0, orderRY: 0, orderRZ: 0,

        // 拡縮（3軸想定 S）
        sXMin: 0, sXMax: 0,
        sYMin: 0, sYMax: 0,
        sZMin: 0, sZMax: 0,
        orderSX: 0, orderSY: 0, orderSZ: 0,

        // 不透明度
        tMin: 0, tMax: 0,
        orderT: 0,

        frameOffset: 20,
        sliderSnap10: true,

        // 位置分布モード
        posMode: 0,   // 0:拡散（範囲ランダム）, 1:座標, 2:X/Y/Z, 3:↑→↓←(2D), 4:X→Y→Z(3D)

        autoStartIn: false,
        autoStartOut: false
    };

    var settings = {};
    for (var key in DEFAULT_VALUES) {
        settings[key] = DEFAULT_VALUES[key];
    }

    var presets = [];

    function resetToDefaults() {
        // DEFAULT_VALUES を深いコピーで settings に反映
        function deepClone(v) {
            if (v && typeof v === "object") {
                if (v instanceof Array) {
                    var a = [];
                    for (var i = 0; i < v.length; i++) a[i] = deepClone(v[i]);
                    return a;
                } else {
                    var o = {};
                    for (var k in v) if (v.hasOwnProperty(k)) o[k] = deepClone(v[k]);
                    return o;
                }
            }
            return v;
        }
        for (var key in DEFAULT_VALUES) {
            if (DEFAULT_VALUES.hasOwnProperty(key)) {
                settings[key] = deepClone(DEFAULT_VALUES[key]);
            }
        }
    }
  

  
    
    // --- JSONセーフラッパー（ExtendScriptの古環境対策） ---
    function _jsonStringify(obj) {
        try {
            if (typeof JSON !== "undefined" && JSON && JSON.stringify) {
                return JSON.stringify(obj, null, 2);
            }
        } catch (e) {}
        function esc(s){return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\r?\n/g,"\\n");}
        function ser(x){
            if (x === null) return "null";
            var t = typeof x;
            if (t === "string")  return '"' + esc(x) + '"';
            if (t === "number")  return isFinite(x) ? String(x) : "null";
            if (t === "boolean") return x ? "true" : "false";
            if (x instanceof Array) { var a=[]; for (var i=0;i<x.length;i++) a.push(ser(x[i])); return "["+a.join(",")+"]"; }
            if (t === "object")  { var kv=[]; for (var k in x) if (x.hasOwnProperty(k)) {
                                    var v=x[k]; if (typeof v!=="function" && typeof v!=="undefined") kv.push('"'+esc(k)+'":'+ser(v));
                                } return "{"+kv.join(",")+"}"; }
            return "null";
        }
        return ser(obj);
    }
    function _jsonParse(text) {
        try { if (typeof JSON!=="undefined" && JSON && JSON.parse) return JSON.parse(text); } catch(e){}
        try { return eval("(" + text + ")"); } catch(e2){ return []; }
    }

    function _jsonParse(text) {
        try {
            if (typeof JSON !== "undefined" && JSON && JSON.parse) return JSON.parse(text);
        } catch (e) {}
        // 自分で書き出した JSON しか読まない前提で eval 代替（外部入力は使用しない想定）
        try { return eval("(" + text + ")"); } catch (e2) { return []; }
    }

    // ========================================
    // プリセット管理
    // ========================================
    // Folder.userData は Folderオブジェクトなので文字列化して使う
    function getPresetFilePath() {
        // 1) 実行中スクリプトと同じフォルダを最優先
        try {
            var scriptFile = new File($.fileName); // 実行中の .jsx / .jsxbin
            if (scriptFile && scriptFile.parent && scriptFile.parent.exists) {
                var scriptDir = scriptFile.parent.fullName;
                return scriptDir + "/" + PRESET_FILE; // 例: AE_RandomMotion_v1_04.jsx と同じ場所
            }
        } catch (e) {
            // 無視してフォールバックへ
        }

        // 2) フォールバック: 従来の userData パス
        var basePath = (Folder.userData && Folder.userData.fsName)
            ? Folder.userData.fsName
            : Folder.userData.fullName;

        var targetPath = basePath + "/Adobe/After Effects/RandomMotion";

        // 必要な中間ディレクトリも作成
        var folder = new Folder(targetPath);
        if (!folder.exists) {
            var parts = targetPath.split("/");
            var acc = parts[0];
            for (var i = 1; i < parts.length; i++) {
                acc += "/" + parts[i];
                var f = new Folder(acc);
                if (!f.exists) f.create();
            }
        }
        return folder.fullName + "/" + PRESET_FILE;
    }

    function loadPresets() {
        // 候補: スクリプトと同じ場所 → userData の順で探す
        var candidates = [];

        // スクリプト隣
        try {
            var scriptFile = new File($.fileName);
            if (scriptFile && scriptFile.parent && scriptFile.parent.exists) {
                candidates.push(scriptFile.parent.fullName + "/" + PRESET_FILE);
            }
        } catch (e) {}

        // userData 側
        var basePath = (Folder.userData && Folder.userData.fsName)
            ? Folder.userData.fsName
            : Folder.userData.fullName;
        var targetPath = basePath + "/Adobe/After Effects/RandomMotion";
        candidates.push(targetPath + "/" + PRESET_FILE);

        for (var i = 0; i < candidates.length; i++) {
            var f = new File(candidates[i]);
            if (f.exists) {
                if (f.open("r")) {
                    var content = f.read();
                    f.close();
                    presets = _jsonParse(content) || [];
                    return;
                }
            }
        }
        presets = []; // 見つからない場合
    }

    
    function savePresets() {
        // 先に文字列化（ここで失敗したらファイルを触らない）
        var text = _jsonStringify(presets);
        if (typeof text !== "string" || text === "") text = "[]";

        // 優先：スクリプトと同じ場所
        var primaryPath = getPresetFilePath(); // 既存（スクリプト横→無理なら userData を返すでもOK）
        var tried = [];
        if (primaryPath) {
            tried.push(primaryPath);
            try {
                var pf = new File(primaryPath);
                var pdir = pf.parent; if (!pdir.exists) pdir.create();
                if (pf.open("w")) {
                    pf.encoding = "UTF-8";
                    pf.lineFeed = "Unix";
                    pf.write(text);
                    pf.close();
                    return;
                }
            } catch (e) {}
        }

        // フォールバック：userData 側
        var basePath = (Folder.userData && Folder.userData.fsName) ? Folder.userData.fsName : Folder.userData.fullName;
        var targetDir = basePath + "/Adobe/After Effects/RandomMotion";
        var folder = new Folder(targetDir);
        if (!folder.exists) {
            var parts = targetDir.split("/"); var acc = parts[0];
            for (var i=1;i<parts.length;i++){ acc+="/"+parts[i]; var d=new Folder(acc); if(!d.exists) d.create(); }
        }
        var fallbackPath = folder.fullName + "/" + PRESET_FILE;
        tried.push(fallbackPath);
        try {
            var ff = new File(fallbackPath);
            if (ff.open("w")) {
                ff.encoding = "UTF-8";
                ff.lineFeed = "Unix";
                ff.write(text);
                ff.close();
                return;
            }
        } catch (e2) {}

        alert("プリセットを保存できませんでした。\n試行した場所:\n- " + tried.join("\n- "));
    }


    
    function addPreset(name, values) {
        // 名前の「,」を空白に置換
        name = name.replace(/,/g, " ");
        if (name === "") {
            name = "Preset_" + (presets.length + 1);
        }
        presets.push({name: name, values: values});
        savePresets();
    }
    
    function removePreset(index) {
        presets.splice(index, 1);
        savePresets();
    }
    
    function movePreset(index, direction) {
        if (direction === -1 && index > 0) {
            var temp = presets[index];
            presets[index] = presets[index - 1];
            presets[index - 1] = temp;
            savePresets();
            return index - 1;
        } else if (direction === 1 && index < presets.length - 1) {
            var temp = presets[index];
            presets[index] = presets[index + 1];
            presets[index + 1] = temp;
            savePresets();
            return index + 1;
        }
        return index;
    }
    
    function exportPresets() {
        var file = File.saveDialog("プリセットをエクスポート", "JSON:*.json");
        if (!file) return;

        // 先に安全に文字列化（ここで失敗したらファイルを触らない）
        var text = _jsonStringify(presets);
        if (typeof text !== "string" || text === "") text = "[]";

        // 拡張子 .json を付与
        if (!/\.json$/i.test(file.name)) file = new File(file.fsName + ".json");

        // 書き込み
        if (file.open("w")) {
            file.encoding = "UTF-8";
            file.lineFeed = "Unix";
            file.write(text);
            file.close();
            alert("プリセットをエクスポートしました");
        } else {
            alert("ファイルを開けませんでした：\n" + file.fsName);
        }
    }

    function importPresets() {
        var file = File.openDialog("プリセットをインポート", "JSON:*.json");
        if (!file) return;

        if (file.open("r")) {
            var content = file.read();
            file.close();

            var arr = _jsonParse(content);
            if (!(arr instanceof Array)) {
                alert("プリセットファイルの形式が不正です。");
                return;
            }
            presets = arr;      // 置換（必要ならマージに変更可）
            savePresets();      // 内部保存も更新
            alert("プリセットをインポートしました（既存のプリセットは置換されました）");
        } else {
            alert("ファイルを開けませんでした：\n" + file.fsName);
        }
    }

    // ========================================
    // ユーティリティ関数
    // ========================================
    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    function normalizeSliderValue(rawValue, sliderMin, sliderMax) {
        var val = clamp(rawValue, sliderMin, sliderMax);
        if (settings.sliderSnap10) {
            val = Math.round(val / 10) * 10;
            val = clamp(val, sliderMin, sliderMax);
        } else {
            val = Math.round(val);
        }
        return val;
    }
    
    function randomRange(min, max) {
        return min + Math.random() * (max - min);
    }
    
    function validateMinMax() {
        // min と max が逆になっていたら自動で入れ替える（数値化もここで保証）
        function normalizePair(minKey, maxKey) {
            var minVal = Number(settings[minKey]);
            var maxVal = Number(settings[maxKey]);

            // 数値でない場合の保険
            if (!isFinite(minVal)) minVal = 0;
            if (!isFinite(maxVal)) maxVal = 0;

            // 逆なら入れ替え
            if (minVal > maxVal) {
                var tmp = minVal;
                minVal = maxVal;
                maxVal = tmp;
            }

            // settings に戻す（数値として揃える）
            settings[minKey] = minVal;
            settings[maxKey] = maxVal;
        }

        normalizePair("xMin", "xMax");
        normalizePair("yMin", "yMax");
        normalizePair("zMin", "zMax");

        normalizePair("rXMin", "rXMax");
        normalizePair("rYMin", "rYMax");
        normalizePair("rZMin", "rZMax");

        normalizePair("sXMin", "sXMax");
        normalizePair("sYMin", "sYMax");
        normalizePair("sZMin", "sZMax");

        normalizePair("tMin", "tMax");

        // UIがあれば表示も更新
        if (typeof syncSettingsToUI === "function" && UIREF) {
            syncSettingsToUI();
        }

        // ここでは常に true（エラー扱いにしない）
        return true;
    }


    
    function allValuesZero() {
        return settings.xMin === 0 && settings.xMax === 0 &&
               settings.yMin === 0 && settings.yMax === 0 &&
               settings.zMin === 0 && settings.zMax === 0 &&
               settings.rXMin === 0 && settings.rXMax === 0 &&
               settings.rYMin === 0 && settings.rYMax === 0 &&
               settings.rZMin === 0 && settings.rZMax === 0 &&
               settings.sXMin === 0 && settings.sXMax === 0 &&
               settings.sYMin === 0 && settings.sYMax === 0 &&
               settings.sZMin === 0 && settings.sZMax === 0 &&
               settings.tMin === 0 && settings.tMax === 0;
    }
    
    // 値生成：min/max と順番から符号を決める
    function sampleValueWithOrder(minVal, maxVal, orderMode, index) {
        // orderMode: 0=ランダム, 1=-+-+ (min→max…), 2=+-+- (max→min…)
        if ((orderMode | 0) === 0) {
            return randomRange(minVal || 0, maxVal || 0);
        }

        var base = randomRange(minVal || 0, maxVal || 0);
        var magnitude = Math.abs(base);

        var signFromMin = (minVal < 0) ? -1 : 1;
        var signFromMax = (maxVal < 0) ? -1 : 1;

        var useMinFirst = (orderMode | 0) === 0; // 0: min→max→min→max / 1: max→min→max→min
        var useMinSign = useMinFirst ? (index % 2 === 0) : (index % 2 !== 0);
        var sign = useMinSign ? signFromMin : signFromMax;

        if (sign === 0) sign = 1;
        return magnitude * sign;
    }

    function pickExtremeWithOrder(minVal, maxVal, orderMode, index) {
        var useMinFirst = (orderMode | 0) === 1;
        var useMaxFirst = (orderMode | 0) === 2;
        var chooseMin;
        if (useMinFirst) {
            chooseMin = (index % 2 === 0);
        } else if (useMaxFirst) {
            chooseMin = (index % 2 !== 0);
        } else {
            chooseMin = (Math.random() < 0.5);
        }
        return chooseMin ? minVal : maxVal;
    }

    
    // ========================================
    // キーフレーム生成
    // ========================================
    function applyRandomMotion() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            alert("コンポジションを開いてください");
            return;
        }
        
        var layers = comp.selectedLayers;
        if (layers.length === 0) {
            alert("レイヤーを選択してください");
            return;
        }
        
        if (!validateMinMax()) {
            alert("エラー: 最小値が最大値より大きい項目があります");
            return;
        }
        
        if (allValuesZero()) {
            alert("すべての値が0です。キーフレームは生成されません");
            return;
        }
        
        app.beginUndoGroup(SCRIPT_NAME + " - Apply");
        
        try {
            for (var i = 0; i < layers.length; i++) {
                applyToLayer(layers[i], comp, i);
            }
        } catch(e) {
            alert("エラー: " + e.toString());
        }
        
        app.endUndoGroup();
    }
        
    function applyToLayer(layer, comp, layerIndex) {
        var currentTime   = comp.time;
        var frameOffset   = settings.frameOffset;
        var frameDuration = comp.frameDuration;

        // 始点時間の決定
        var startTime;
        if (settings.autoStartIn && settings.autoStartOut) {
            // 両方ON: イン点とアウト点に2キーを固定（既存仕様のまま）
            applyTwoKeys(layer, layer.inPoint, layer.outPoint, layerIndex);
            return;
        } else if (settings.autoStartIn) {
            startTime = layer.inPoint;
        } else if (settings.autoStartOut) {
            startTime = layer.outPoint;
        } else {
            startTime = currentTime;
        }

        // オフセット時間（フレーム → 秒）
        var offsetTime = frameOffset * frameDuration;

        // 修正ポイント：
        // 正負にかかわらず、
        //   time1 = startTime + offsetTime  (← ランダム適用後の値を打つ時刻)
        //   time2 = startTime               (← 元の値を保持する時刻)
        //
        // これにより frameOffset = -10 の場合は
        //   time1 = 現在 - 10f
        //   time2 = 現在
        // となり、「現在から10フレーム前に“ランダム適用したキー”が打たれる」挙動になります。
        var time1 = startTime + offsetTime; // ランダム適用後
        var time2 = startTime;              // 元の値

        // 各プロパティに適用（既存関数は time1=適用／time2=元 を前提に実装済み）
        applyPosition(layer, time1, time2, layerIndex);
        applyRotation(layer, time1, time2, layerIndex);
        applyScale(layer, time1, time2, layerIndex);
        applyOpacity(layer, time1, time2, layerIndex);
    }

    
    function applyTwoKeys(layer, time1, time2, layerIndex) {
        // イン点とアウト点に2キーを配置（自動始点両方ON時）
        applyPosition(layer, time1, time2, layerIndex);
        applyRotation(layer, time1, time2, layerIndex);
        applyScale(layer, time1, time2, layerIndex);
        applyOpacity(layer, time1, time2, layerIndex);
    }
        
function applyPosition(layer, time1, time2, layerIndex) {
    // X/Y/Z が全部 0 なら何もしない
    if (settings.xMin === 0 && settings.xMax === 0 &&
        settings.yMin === 0 && settings.yMax === 0 &&
        settings.zMin === 0 && settings.zMax === 0) return;

    var tr = layer.property("ADBE Transform Group");
    var pos = tr.property("ADBE Position");

    // 3D判定（レイヤーが3Dの時だけZを動かす）
    var is3DLayer = !!layer.threeDLayer;

    // Separate Dimensions
    var isSeparate = pos.dimensionsSeparated;

    var deltas = calculatePositionDelta(layerIndex, is3DLayer);

    if (isSeparate) {
        var xProp = tr.property("ADBE Position_0");
        var yProp = tr.property("ADBE Position_1");

        // 3Dなら Z も（無ければ null）
        var zProp = null;
        if (is3DLayer) zProp = tr.property("ADBE Position_2");

        var originalX = xProp.valueAtTime(time2, false);
        var originalY = yProp.valueAtTime(time2, false);
        var originalZ = (zProp) ? zProp.valueAtTime(time2, false) : 0;

        xProp.setValueAtTime(time1, originalX + deltas.x);
        xProp.setValueAtTime(time2, originalX);

        yProp.setValueAtTime(time1, originalY + deltas.y);
        yProp.setValueAtTime(time2, originalY);

        if (zProp) {
            zProp.setValueAtTime(time1, originalZ + deltas.z);
            zProp.setValueAtTime(time2, originalZ);
        }

    } else {
        var original = pos.valueAtTime(time2, false);
        var hasZ = is3DLayer && (original instanceof Array) && (original.length >= 3);

        var newVal;
        if (hasZ) {
            newVal = [original[0] + deltas.x, original[1] + deltas.y, original[2] + deltas.z];
        } else {
            // 2DはZ無視
            newVal = [original[0] + deltas.x, original[1] + deltas.y];
        }

        pos.setValueAtTime(time1, newVal);
        pos.setValueAtTime(time2, original);
    }
}

    function applyRotation(layer, time1, time2, layerIndex) {
        var tr = layer.property("ADBE Transform Group");
        var is3DLayer = !!layer.threeDLayer;

        if (settings.rXMin === 0 && settings.rXMax === 0 &&
            settings.rYMin === 0 && settings.rYMax === 0 &&
            settings.rZMin === 0 && settings.rZMax === 0) return;

        var rotZ = tr.property("ADBE Rotate Z");
        var rotX = is3DLayer ? tr.property("ADBE Rotate X") : null;
        var rotY = is3DLayer ? tr.property("ADBE Rotate Y") : null;

        if (!rotZ) return;

        // 3D: X/Y/Z を個別に。2D: Z のみ
        if (rotX && rotY) {
            var deltaRX = sampleValueWithOrder(settings.rXMin, settings.rXMax, settings.orderRX, layerIndex);
            var deltaRY = sampleValueWithOrder(settings.rYMin, settings.rYMax, settings.orderRY, layerIndex);
            var deltaRZ = sampleValueWithOrder(settings.rZMin, settings.rZMax, settings.orderRZ, layerIndex);

            var origX = rotX.valueAtTime(time2, false);
            var origY = rotY.valueAtTime(time2, false);
            var origZ = rotZ.valueAtTime(time2, false);

            rotX.setValueAtTime(time1, origX + deltaRX);
            rotX.setValueAtTime(time2, origX);

            rotY.setValueAtTime(time1, origY + deltaRY);
            rotY.setValueAtTime(time2, origY);

            rotZ.setValueAtTime(time1, origZ + deltaRZ);
            rotZ.setValueAtTime(time2, origZ);
        } else {
            // 2Dレイヤー：Zのみ
            var delta2D = sampleValueWithOrder(settings.rZMin, settings.rZMax, settings.orderRZ, layerIndex);
            var orig2D = rotZ.valueAtTime(time2, false);
            rotZ.setValueAtTime(time1, orig2D + delta2D);
            rotZ.setValueAtTime(time2, orig2D);
        }
    }

    // 拡縮は分布モードに準拠（S-Mode廃止）
    function applyScale(layer, time1, time2, layerIndex) {
        if (settings.sXMin === 0 && settings.sXMax === 0 &&
            settings.sYMin === 0 && settings.sYMax === 0 &&
            settings.sZMin === 0 && settings.sZMax === 0) return;

        var scale = layer.property("ADBE Transform Group").property("ADBE Scale");
        var original = scale.valueAtTime(time2, false);

        var hasZ = (original instanceof Array) && (original.length >= 3);

        var deltas = calculateScaleDelta(layerIndex, hasZ);

        var newX = original[0] + deltas.x;
        var newY = original[1] + deltas.y;
        var newZ = hasZ ? original[2] + deltas.z : 0;

        // 0跨ぎ防止
        if ((original[0] > 0 && newX < 0) || (original[0] < 0 && newX > 0)) newX = 0;
        if ((original[1] > 0 && newY < 0) || (original[1] < 0 && newY > 0)) newY = 0;
        if (hasZ) {
            if ((original[2] > 0 && newZ < 0) || (original[2] < 0 && newZ > 0)) newZ = 0;
        }

        if (hasZ) {
            scale.setValueAtTime(time1, [newX, newY, newZ]);
        } else {
            scale.setValueAtTime(time1, [newX, newY]);
        }
        scale.setValueAtTime(time2, original);
    }

    function applyOpacity(layer, time1, time2, layerIndex) {
        if (settings.tMin === 0 && settings.tMax === 0) return;

        var opacity = layer.property("ADBE Transform Group").property("ADBE Opacity");
        var original = opacity.valueAtTime(time2, false);

        var mode = (settings.posMode | 0);
        var delta;
        if (mode === 1) { // 座標: min/maxのみ
            delta = pickExtremeWithOrder(settings.tMin, settings.tMax, settings.orderT, layerIndex);
        } else { // 拡散やその他のモード
            delta = sampleValueWithOrder(settings.tMin, settings.tMax, settings.orderT, layerIndex);
        }

        var newValue = clamp(original - delta, 0, 100);
        opacity.setValueAtTime(time1, newValue);
        opacity.setValueAtTime(time2, original);
    }

        
    function calculatePositionDelta(layerIndex, is3DLayer) {
        var mode = (settings.posMode | 0);
        var canZ = !!is3DLayer;

        function valX() { return sampleValueWithOrder(settings.xMin, settings.xMax, settings.orderX, layerIndex); }
        function valY() { return sampleValueWithOrder(settings.yMin, settings.yMax, settings.orderY, layerIndex); }
        function valZ() { return sampleValueWithOrder(settings.zMin, settings.zMax, settings.orderZ, layerIndex); }

        var dx = 0, dy = 0, dz = 0;

        switch (mode) {
            case 2: // X/Y/Z（どれか一方）※2DならX/Yのみ
                if (canZ) {
                    var pick3 = Math.floor(Math.random() * 3);
                    if (pick3 === 0) dx = valX();
                    else if (pick3 === 1) dy = valY();
                    else dz = valZ();
                } else {
                    if (Math.random() < 0.5) dx = valX();
                    else                     dy = valY();
                }
                break;

            case 3: // ↑→↓←（2D想定：XかYのみ。Zは動かさない）
                if ((layerIndex % 2) === 0) dx = valX();
                else                        dy = valY();
                break;

            case 4: // X→Y→Z（3Dの分布用。2DならX→Y）
                if (canZ) {
                    var pickSeq = (layerIndex % 3);
                    if (pickSeq === 0) dx = valX();
                    else if (pickSeq === 1) dy = valY();
                    else dz = valZ();
                } else {
                    if ((layerIndex % 2) === 0) dx = valX();
                    else                        dy = valY();
                }
                break;

            case 1: // 座標：極値のみ
                dx = pickExtremeWithOrder(settings.xMin, settings.xMax, settings.orderX, layerIndex);
                dy = pickExtremeWithOrder(settings.yMin, settings.yMax, settings.orderY, layerIndex);
                if (canZ) dz = pickExtremeWithOrder(settings.zMin, settings.zMax, settings.orderZ, layerIndex);
                break;

            // 0:拡散, 1:座標（どちらも min～max の範囲ランダム）
            default:
                dx = valX();
                dy = valY();
                if (canZ) dz = valZ();
                break;
        }

        return { x: dx, y: dy, z: dz };
    }

    function calculateScaleDelta(layerIndex, hasZ) {
        var mode = (settings.posMode | 0);
        var canZ = !!hasZ;

        function valSX() { return sampleValueWithOrder(settings.sXMin, settings.sXMax, settings.orderSX, layerIndex); }
        function valSY() { return sampleValueWithOrder(settings.sYMin, settings.sYMax, settings.orderSY, layerIndex); }
        function valSZ() { return sampleValueWithOrder(settings.sZMin, settings.sZMax, settings.orderSZ, layerIndex); }

        var dx = 0, dy = 0, dz = 0;

        switch (mode) {
            case 2: // X/Y/Z（どれか一方）
                if (canZ) {
                    var pick3 = Math.floor(Math.random() * 3);
                    if (pick3 === 0) dx = valSX();
                    else if (pick3 === 1) dy = valSY();
                    else dz = valSZ();
                } else {
                    if (Math.random() < 0.5) dx = valSX();
                    else                     dy = valSY();
                }
                break;

            case 3: // ↑→↓←（2D想定）
                if ((layerIndex % 2) === 0) dx = valSX();
                else                        dy = valSY();
                break;

            case 4: // X→Y→Z（3DのみZ）
                if (canZ) {
                    var pickSeq = (layerIndex % 3);
                    if (pickSeq === 0) dx = valSX();
                    else if (pickSeq === 1) dy = valSY();
                    else dz = valSZ();
                } else {
                    if ((layerIndex % 2) === 0) dx = valSX();
                    else                        dy = valSY();
                }
                break;

            case 1: // 座標：極値のみ
                dx = pickExtremeWithOrder(settings.sXMin, settings.sXMax, settings.orderSX, layerIndex);
                dy = pickExtremeWithOrder(settings.sYMin, settings.sYMax, settings.orderSY, layerIndex);
                if (canZ) dz = pickExtremeWithOrder(settings.sZMin, settings.sZMax, settings.orderSZ, layerIndex);
                break;

            default: // 拡散/座標
                dx = valSX();
                dy = valSY();
                if (canZ) dz = valSZ();
                break;
        }

        return { x: dx, y: dy, z: dz };
    }

    // ========================================
    // ヘルプ（ツールチップ＆ステータスバー）
    // ========================================
    function attachHelpTips(ui) {
        // ボタン系
        ui.btnApply.helpTip    = "設定に基づいてキーフレームを生成します。\n全プロパティが0なら何もしません。";
        ui.btnGotoIn.helpTip   = "選択レイヤーのイン点へ移動（I相当）。\n右クリックで“始点=イン点固定”トグル。";
        ui.btnGotoOut.helpTip  = "選択レイヤーのアウト点へ移動（O相当）。\n右クリックで“始点=アウト点固定”トグル。";
        ui.btnPreset.helpTip   = "プリセットウィンドウを開きます（パネル右クリックでもカーソル位置に開く）。";
        ui.btnSignFlip.helpTip = "フレームオフセットの±を一括反転します。";

        // フレーム
        ui.frameSlider.helpTip = "現在時間からのずらし量（フレーム）。\n正:「動いた後→元の値」/ 負:「元→動いた後」。";
        ui.frameText.helpTip   = "フレームの整数入力。±どちらも可。";
        if (ui.snapCheck) ui.snapCheck.helpTip = "ON: モーション値スライダーを10刻みでスナップ。OFF: 1刻み（フレームは常に1刻み）。";

        function setRowHelp(row, name, detail, isPercent) {
            var minHelp = name + " の最小値" + detail;
            var maxHelp = name + " の最大値" + detail;
            var unit = isPercent ? "（%）" : "";
            if (row.minText) row.minText.helpTip = minHelp + unit;
            if (row.minSlider) row.minSlider.helpTip = minHelp + unit;
            if (row.maxText) row.maxText.helpTip = maxHelp + unit;
            if (row.maxSlider) row.maxSlider.helpTip = maxHelp + unit;
            if (row.orderDD && row.updateOrderHelp) row.updateOrderHelp();
        }

        setRowHelp(ui.posRows.x, "T X", "。分布設定に従い min～max の間で動きます。", false);
        setRowHelp(ui.posRows.y, "T Y", "。分布設定に従い min～max の間で動きます。", false);
        setRowHelp(ui.posRows.z, "T Z", "（3Dレイヤーのみ有効）。分布設定に従い min～max の間で動きます。", false);

        setRowHelp(ui.rotRows.x, "R X", "（度）。", false);
        setRowHelp(ui.rotRows.y, "R Y", "（度）。", false);
        setRowHelp(ui.rotRows.z, "R Z", "（度）。2Dレイヤーでは Z のみ反映。", false);

        setRowHelp(ui.scaleRows.x, "S X", "。0 を跨ぐ場合は 0 で停止します。", false);
        setRowHelp(ui.scaleRows.y, "S Y", "。0 を跨ぐ場合は 0 で停止します。", false);
        setRowHelp(ui.scaleRows.z, "S Z", "。3Dスケールのみ有効。0 を跨ぐ場合は 0 で停止します。", false);

        setRowHelp(ui.opacityRow, "透明度", "。現在値から差し引く量を指定します。", true);

        // 位置モード（▼追加モード込み）
        var posHelps = [
            "拡散：X/Y（3DならZも）を同時に動かします。min～max の範囲からランダムに値を選びます。",
            "座標：X/Y（3DならZも）を同時に動かします。min または max のどちらかのみを使います（中間値なし）。",
            "X/Y/Z：1軸だけ動かします（2DはX/Y）。",
            "↑→↓←：2D想定でXかYのみ（Zは動かしません）。",
            "X→Y→Z：レイヤー順で軸を分配（2DはX→Y）。"
        ];
        if (ui.rbPos && ui.rbPos.length) {
            for (var j = 0; j < ui.rbPos.length && j < posHelps.length; j++) {
                ui.rbPos[j].helpTip = posHelps[j];
            }
        }
    }


    // ステータスバーに hover 説明を反映
    function bindHoverHelp(ctrl, text, helpBar) {
        if (!ctrl) return;
        var firstLine = (text && text.split) ? text.split("\n")[0] : ""; // ★未定義でも安全
        try {
            if (ctrl.addEventListener) {
                ctrl.addEventListener("mouseover", function(){ helpBar.text = "ヒント：" + firstLine; });
                ctrl.addEventListener("mouseout",  function(){ helpBar.text = "ヒント："; });
            }
        } catch(e) {}
    }
    
    // ========================================
    // UI構築
    // ========================================
    // ★buildUI を丸ごと置き換え（順番ドロップダウンと横並びレイアウト）
    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel) ? thisObj : new Window("palette", SCRIPT_NAME, undefined, {resizeable: true});

        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 5;
        win.margins = 10;

        // --- パネル: モーション設定 ---
        var motionGroup = win.add("panel", undefined, "モーション設定");
        motionGroup.orientation = "column";
        motionGroup.alignChildren = ["fill", "top"];
        motionGroup.spacing = 5;
        motionGroup.margins = 10;

        var orderLabels = ["―", "-+-+", "+-+-"];

        var snapRow = motionGroup.add("group");
        snapRow.alignment = ["left", "top"];
        var snapCheck = snapRow.add("checkbox", undefined, "10刻み");
        snapCheck.value = !!settings.sliderSnap10;
        snapCheck.onClick = function () {
            settings.sliderSnap10 = !!snapCheck.value;
            if (typeof syncSettingsToUI === "function") syncSettingsToUI();
        };

        function createValueRow(parent, label, minKey, maxKey, orderKey, sliderMin, sliderMax) {
            var row = parent.add("group");
            row.alignment = ["fill", "top"];
            row.spacing = 10;

            var lbl = row.add("statictext", undefined, label + "：");
            lbl.characters = 4;

            var orderDD = row.add("dropdownlist", undefined, orderLabels);
            orderDD.selection = orderDD.items[Math.min(Math.max(settings[orderKey] | 0, 0), orderLabels.length - 1)];

            var minGroup = row.add("group");
            minGroup.add("statictext", undefined, "min:");
            var minText = minGroup.add("edittext", undefined, String(settings[minKey] || 0));
            minText.characters = 6;
            var minSlider = minGroup.add("slider", undefined, settings[minKey] || 0, sliderMin, sliderMax);
            minSlider.preferredSize.width = 180;
            var minReset = minGroup.add("button", undefined, "Reset");
            minReset.preferredSize.width = 50;

            var maxGroup = row.add("group");
            maxGroup.add("statictext", undefined, "max:");
            var maxText = maxGroup.add("edittext", undefined, String(settings[maxKey] || 0));
            maxText.characters = 6;
            var maxSlider = maxGroup.add("slider", undefined, settings[maxKey] || 0, sliderMin, sliderMax);
            maxSlider.preferredSize.width = 180;
            var maxReset = maxGroup.add("button", undefined, "Reset");
            maxReset.preferredSize.width = 50;

            function updateOrderHelp() {
                var sel = orderDD.selection ? orderDD.selection.index : 0;
                var orderText;
                if (sel === 0) {
                    orderText = "ランダム（順番指定なし）";
                } else if (sel === 1) {
                    orderText = "-+-+（偶数: min 符号 / 奇数: max 符号）";
                } else {
                    orderText = "+-+-（偶数: max 符号 / 奇数: min 符号）";
                }
                orderDD.helpTip = label + " の適用順序: " + orderText +
                    "。現在: min=" + settings[minKey] + ", max=" + settings[maxKey] + "。";
            }

            minSlider.onChanging = function () {
                settings[minKey] = normalizeSliderValue(minSlider.value, sliderMin, sliderMax);
                minSlider.value = settings[minKey];
                minText.text = settings[minKey];
                updateOrderHelp();
            };
            minText.onChange = function () {
                var val = parseFloat(minText.text) || 0;
                settings[minKey] = clamp(val, sliderMin, sliderMax);
                minSlider.value = settings[minKey];
                updateOrderHelp();
            };

            maxSlider.onChanging = function () {
                settings[maxKey] = normalizeSliderValue(maxSlider.value, sliderMin, sliderMax);
                maxSlider.value = settings[maxKey];
                maxText.text = settings[maxKey];
                updateOrderHelp();
            };
            maxText.onChange = function () {
                var val = parseFloat(maxText.text) || 0;
                settings[maxKey] = clamp(val, sliderMin, sliderMax);
                maxSlider.value = settings[maxKey];
                updateOrderHelp();
            };

            orderDD.onChange = function () {
                settings[orderKey] = orderDD.selection.index;
                updateOrderHelp();
            };

            minReset.onClick = function () {
                settings[minKey] = 0;
                minText.text = settings[minKey];
                minSlider.value = settings[minKey];
                updateOrderHelp();
            };

            maxReset.onClick = function () {
                settings[maxKey] = 0;
                maxText.text = settings[maxKey];
                maxSlider.value = settings[maxKey];
                updateOrderHelp();
            };

            updateOrderHelp();

            return {
                row: row,
                minText: minText,
                maxText: maxText,
                minSlider: minSlider,
                maxSlider: maxSlider,
                minReset: minReset,
                maxReset: maxReset,
                orderDD: orderDD,
                updateOrderHelp: updateOrderHelp
            };
        }

        var rowsContainer = motionGroup.add("group");
        rowsContainer.orientation = "column";
        rowsContainer.alignChildren = ["fill", "top"];
        rowsContainer.spacing = 4;

        // 位置（T）
        var rowPosX = createValueRow(rowsContainer, "T X", "xMin", "xMax", "orderX", -2000, 2000);
        var rowPosY = createValueRow(rowsContainer, "T Y", "yMin", "yMax", "orderY", -2000, 2000);
        var rowPosZ = createValueRow(rowsContainer, "T Z", "zMin", "zMax", "orderZ", -2000, 2000);

        // 回転（R）
        var rowRotX = createValueRow(rowsContainer, "R X", "rXMin", "rXMax", "orderRX", -180, 180);
        var rowRotY = createValueRow(rowsContainer, "R Y", "rYMin", "rYMax", "orderRY", -180, 180);
        var rowRotZ = createValueRow(rowsContainer, "R Z", "rZMin", "rZMax", "orderRZ", -180, 180);

        // 拡縮（S）
        var rowScaleX = createValueRow(rowsContainer, "S X", "sXMin", "sXMax", "orderSX", -400, 400);
        var rowScaleY = createValueRow(rowsContainer, "S Y", "sYMin", "sYMax", "orderSY", -400, 400);
        var rowScaleZ = createValueRow(rowsContainer, "S Z", "sZMin", "sZMax", "orderSZ", -400, 400);

        // 不透明度
        var rowOpacity = createValueRow(rowsContainer, "透明度", "tMin", "tMax", "orderT", 0, 100);

        // フレーム指定
        var frameGroup = motionGroup.add("group");
        frameGroup.alignment = ["fill", "top"];
        frameGroup.add("statictext", undefined, "フレーム:");
        var frameSlider = frameGroup.add("slider", undefined, settings.frameOffset || 10, -100, 100);
        frameSlider.preferredSize.width = 150;
        var frameText = frameGroup.add("edittext", undefined, String(settings.frameOffset || 10));
        frameText.characters = 5;
        var btnSignFlip = frameGroup.add("button", undefined, "+-");
        btnSignFlip.preferredSize.width = 30;

        frameSlider.onChanging = function(){
            settings.frameOffset = Math.round(frameSlider.value);
            frameText.text = settings.frameOffset;
        };
        frameText.onChange = function(){
            settings.frameOffset = parseInt(frameText.text, 10) || 0;
            frameSlider.value = settings.frameOffset;
        };
        btnSignFlip.onClick = function () {
            var v = parseInt(frameText.text, 10);
            if (isNaN(v)) v = settings.frameOffset || 0;
            settings.frameOffset = -v;
            frameText.text = String(settings.frameOffset);
            frameSlider.value = settings.frameOffset;
        };

        // ▼ 位置モードラジオ（分布：3D用を追加）
        var posGroup = motionGroup.add("group");
        posGroup.add("statictext", undefined, "分布:");
        var posRadios = [];

        // 既存 0..3 を維持し、4 を追加
        var posLabels = ["拡散", "座標", "X/Y/Z", "↑→↓←", "X→Y→Z"];
        for (var j=0; j<posLabels.length; j++){
            var rb2 = posGroup.add("radiobutton", undefined, posLabels[j]);
            posRadios.push(rb2);
            rb2.value = (j === (settings.posMode|0));
            (function(idx){ rb2.onClick = function(){ settings.posMode = idx; }; })(j);
        }

        // --- ボタン行 ---
        var btnGroup = motionGroup.add("group");
        btnGroup.alignment = ["fill", "top"];

        var btnGotoIn  = btnGroup.add("button", undefined, "<");  btnGotoIn.preferredSize.width = 40;
        var btnGotoOut = btnGroup.add("button", undefined, ">");  btnGotoOut.preferredSize.width = 40;

        btnGroup.add("statictext", undefined, ""); // spacer

        var btnPreset  = btnGroup.add("button", undefined, "プリセット");  btnPreset.preferredSize.width = 70;

        var btnReset   = btnGroup.add("button", undefined, "Reset");
        btnReset.helpTip = "既定値に戻す（DEFAULT_VALUES を反映）";

        var btnApply   = btnGroup.add("button", undefined, "実行");

        // ▼イベント結線
        btnApply.onClick = function(){ applyRandomMotion(); };
        btnGotoIn.onClick  = function(){ gotoInPoint();  };
        btnGotoOut.onClick = function(){ gotoOutPoint(); };

        // < / > 右クリックで自動始点トグル
        if (btnGotoIn.addEventListener){
            btnGotoIn.addEventListener("mousedown", function(e){
                if (e.button === 2){ settings.autoStartIn = !settings.autoStartIn; if (typeof syncSettingsToUI==="function") syncSettingsToUI(); }
            });
        }
        if (btnGotoOut.addEventListener){
            btnGotoOut.addEventListener("mousedown", function(e){
                if (e.button === 2){ settings.autoStartOut = !settings.autoStartOut; if (typeof syncSettingsToUI==="function") syncSettingsToUI(); }
            });
        }

        // プリセット
        btnPreset.onClick = function(){ showPresetWindow(false); };
        if (btnPreset.addEventListener){
            btnPreset.addEventListener("mousedown", function(e){
                if (e.button === 2) showPresetWindow(true);
            });
        }

        // Reset
        btnReset.onClick = function(){
            resetToDefaults();
            if (typeof syncSettingsToUI === "function") syncSettingsToUI();
        };

        // ヘルプバー
        var helpBar = win.add("statictext", undefined, "Ready.");
        helpBar.alignment = ["fill", "bottom"];

        // UI参照束ね
        var ui = {
            posRows: { x: rowPosX, y: rowPosY, z: rowPosZ },
            rotRows: { x: rowRotX, y: rowRotY, z: rowRotZ },
            scaleRows: { x: rowScaleX, y: rowScaleY, z: rowScaleZ },
            opacityRow: rowOpacity,

            rbPos:  posRadios,
            frameSlider: frameSlider,
            frameText: frameText,
            snapCheck: snapCheck,
            btnSignFlip: btnSignFlip,
            btnGotoIn: btnGotoIn,
            btnGotoOut: btnGotoOut,
            btnPreset: btnPreset,
            btnReset: btnReset,
            btnApply: btnApply
        };

        attachHelpTips(ui);
        UIREF = ui;
        if (typeof syncSettingsToUI === "function") syncSettingsToUI();

        // ホバー時のヘルプ
        function linkHover(ctrl, text){ bindHoverHelp(ctrl, text, helpBar); }
        linkHover(ui.btnApply,   ui.btnApply.helpTip);
        linkHover(ui.btnGotoIn,  ui.btnGotoIn.helpTip);
        linkHover(ui.btnGotoOut, ui.btnGotoOut.helpTip);
        linkHover(ui.btnPreset,  ui.btnPreset.helpTip);
        linkHover(ui.btnReset,   ui.btnReset.helpTip);
        linkHover(ui.btnSignFlip,ui.btnSignFlip.helpTip);
        linkHover(ui.frameSlider,ui.frameSlider.helpTip);
        linkHover(ui.frameText,  ui.frameText.helpTip);
        linkHover(ui.snapCheck,  ui.snapCheck.helpTip);
        function hoverRow(row) {
            if (!row) return;
            if (row.orderDD) linkHover(row.orderDD, row.orderDD.helpTip);
            if (row.minText) linkHover(row.minText, row.minText.helpTip);
            if (row.maxText) linkHover(row.maxText, row.maxText.helpTip);
            if (row.minSlider) linkHover(row.minSlider, row.minSlider.helpTip);
            if (row.maxSlider) linkHover(row.maxSlider, row.maxSlider.helpTip);
        }
        hoverRow(ui.posRows.x); hoverRow(ui.posRows.y); hoverRow(ui.posRows.z);
        hoverRow(ui.rotRows.x); hoverRow(ui.rotRows.y); hoverRow(ui.rotRows.z);
        hoverRow(ui.scaleRows.x); hoverRow(ui.scaleRows.y); hoverRow(ui.scaleRows.z);
        hoverRow(ui.opacityRow);

        win.onResizing = win.onResize = function(){ this.layout.resize(); };
        if (win instanceof Window) { win.center(); win.show(); } else { win.layout.layout(true); }

        return win;
    }


    function syncSettingsToUI() {
        if (!UIREF) return;

        function setRow(row, minKey, maxKey, orderKey) {
            row.minText.text = String(settings[minKey]);
            row.maxText.text = String(settings[maxKey]);
            row.minSlider.value = settings[minKey];
            row.maxSlider.value = settings[maxKey];
            if (row.orderDD && row.orderDD.items) {
                var idx = (settings[orderKey] | 0);
                if (idx < 0 || idx >= row.orderDD.items.length) idx = 0;
                row.orderDD.selection = row.orderDD.items[idx];
            }
            if (row.updateOrderHelp) row.updateOrderHelp();
        }

        setRow(UIREF.posRows.x, "xMin", "xMax", "orderX");
        setRow(UIREF.posRows.y, "yMin", "yMax", "orderY");
        setRow(UIREF.posRows.z, "zMin", "zMax", "orderZ");

        setRow(UIREF.rotRows.x, "rXMin", "rXMax", "orderRX");
        setRow(UIREF.rotRows.y, "rYMin", "rYMax", "orderRY");
        setRow(UIREF.rotRows.z, "rZMin", "rZMax", "orderRZ");

        setRow(UIREF.scaleRows.x, "sXMin", "sXMax", "orderSX");
        setRow(UIREF.scaleRows.y, "sYMin", "sYMax", "orderSY");
        setRow(UIREF.scaleRows.z, "sZMin", "sZMax", "orderSZ");

        setRow(UIREF.opacityRow, "tMin", "tMax", "orderT");

        // フレームオフセット
        if (UIREF.frameSlider && UIREF.frameText) {
            UIREF.frameSlider.value = settings.frameOffset;
            UIREF.frameText.text    = String(settings.frameOffset);
        }
        if (UIREF.snapCheck) {
            UIREF.snapCheck.value = !!settings.sliderSnap10;
        }

        // 位置モードラジオ（追加分も含めて）
        if (UIREF.rbPos && UIREF.rbPos.length) {
            for (var j = 0; j < UIREF.rbPos.length; j++) {
                UIREF.rbPos[j].value = (j === (settings.posMode|0));
            }
        }

        // 自動始点トグル表示（ボタンのラベルに * を付ける仕様）
        if (UIREF.btnGotoIn)  UIREF.btnGotoIn.text  = settings.autoStartIn  ? "<*" : "<";
        if (UIREF.btnGotoOut) UIREF.btnGotoOut.text = settings.autoStartOut ? ">*" : ">";
    }


    function gotoInPoint() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return;
        var layers = comp.selectedLayers;
        if (layers.length === 0) return;
        comp.time = layers[0].inPoint;
    }
    
    function gotoOutPoint() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return;
        var layers = comp.selectedLayers;
        if (layers.length === 0) return;
        comp.time = layers[0].outPoint;
    }
    
    // ========================================
    // プリセットウィンドウ
    // ========================================
    function showPresetWindow(atCursor) {
        var win = new Window("palette", "プリセット", undefined);
        win.orientation = "column";
        win.alignChildren = ["fill", "fill"];
        win.spacing = 10;
        win.margins = 10;

        // リストボックス
        var list = win.add("listbox", undefined, [], { multiselect: false });
        list.preferredSize = [300, 200];
        updatePresetList(list);

        // ダブルクリックで適用（※閉じない）
        list.onDoubleClick = function () {
            if (list.selection) {
                applyPreset(list.selection.index); // ← win.close() しない
            }
        };

        // キー操作：Enter=適用（※閉じない）
        list.addEventListener("keydown", function (e) {
            if (e.keyName === "Enter" && list.selection) {
                applyPreset(list.selection.index); // ← win.close() しない
            }
        });

        // ボタン行
        var btnGroup = win.add("group");
        btnGroup.alignment = ["fill", "top"];

        var btnUp = btnGroup.add("button", undefined, "↑");
        btnUp.preferredSize.width = 30;
        var btnDown = btnGroup.add("button", undefined, "↓");
        btnDown.preferredSize.width = 30;

        btnGroup.add("statictext", undefined, ""); // spacer

        var nameText = btnGroup.add("edittext", undefined, "");
        nameText.characters = 15;
        var btnSave = btnGroup.add("button", undefined, "Save");
        var btnDelete = btnGroup.add("button", undefined, "削除");
        var btnImport = btnGroup.add("button", undefined, "Import");
        var btnExport = btnGroup.add("button", undefined, "Export");

        // 並べ替え
        btnUp.onClick = function () {
            if (list.selection) {
                var newIndex = movePreset(list.selection.index, -1);
                updatePresetList(list);
                list.selection = newIndex;
            }
        };
        btnDown.onClick = function () {
            if (list.selection) {
                var newIndex = movePreset(list.selection.index, 1);
                updatePresetList(list);
                list.selection = newIndex;
            }
        };

        // 保存
        btnSave.onClick = function () {
            var name = nameText.text;
            var values = {};
            for (var key in settings) values[key] = settings[key];
            addPreset(name, values);
            updatePresetList(list);
            nameText.text = "";
        };

        // 削除
        btnDelete.onClick = function () {
            if (list.selection) {
                removePreset(list.selection.index);
                updatePresetList(list);
            }
        };

        // インポート／エクスポート
        btnImport.onClick = function () {
            importPresets();
            updatePresetList(list);
        };
        btnExport.onClick = function () {
            exportPresets();
        };

        // ウィンドウ位置
        if (atCursor) {
            // カーソル近辺（厳密取得不可なので近似）
            win.location = [$.screens[0].left + 100, $.screens[0].top + 100];
        } else {
            win.center();
        }

        win.show();
    }

    
    function updatePresetList(list) {
        list.removeAll();
        for (var i = 0; i < presets.length; i++) {
            list.add("item", presets[i].name);
        }
    }
    
    function applyPreset(index) {
        if (index < 0 || index >= presets.length) return;
        var preset = presets[index];
        for (var key in preset.values) {
            settings[key] = preset.values[key];
        }
        syncSettingsToUI();
        // ← ここにあった alert(...) を削除
    }

    
    // ========================================
    // 初期化
    // ========================================
    loadPresets();
    buildUI(thisObj);
    
})(this);