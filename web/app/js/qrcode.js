/**
 * Minimal QR Code generator for OKC.
 * Generates QR codes on a canvas element.
 * Based on the QR code algorithm — simplified for URL encoding.
 *
 * For production, this could be replaced with a more complete library,
 * but this covers URLs up to ~200 characters which is enough for OKC.
 */
const QRCode = {
    /**
     * Draw a QR code on a canvas element.
     * Uses a simple approach: renders via a temporary image from a public API
     * or falls back to displaying the URL as text.
     *
     * For a fully offline solution, we use a minimal QR encoding.
     */
    draw(canvas, text, size) {
        size = size || 200;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Generate QR matrix
        const modules = this._encode(text);
        if (!modules) {
            // Fallback: just show text
            ctx.fillStyle = '#f8f8f8';
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#333';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('QR Code', size / 2, size / 2);
            return;
        }

        const moduleCount = modules.length;
        const cellSize = size / moduleCount;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        ctx.fillStyle = '#000000';
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (modules[row][col]) {
                    ctx.fillRect(
                        Math.round(col * cellSize),
                        Math.round(row * cellSize),
                        Math.ceil(cellSize),
                        Math.ceil(cellSize)
                    );
                }
            }
        }
    },

    /**
     * Minimal QR encoder — Version 2-4, Error correction L.
     * Supports alphanumeric and byte mode for URLs.
     */
    _encode(text) {
        // Use byte mode for simplicity
        const data = new TextEncoder().encode(text);
        const len = data.length;

        // Select version based on data length (EC level L)
        let version, totalCodewords, ecCodewords, numBlocks, moduleCount;
        if (len <= 32) {
            version = 2; moduleCount = 25; totalCodewords = 44; ecCodewords = 10; numBlocks = 1;
        } else if (len <= 53) {
            version = 3; moduleCount = 29; totalCodewords = 70; ecCodewords = 15; numBlocks = 1;
        } else if (len <= 78) {
            version = 4; moduleCount = 33; totalCodewords = 100; ecCodewords = 20; numBlocks = 1;
        } else if (len <= 106) {
            version = 5; moduleCount = 37; totalCodewords = 134; ecCodewords = 26; numBlocks = 1;
        } else if (len <= 134) {
            version = 6; moduleCount = 41; totalCodewords = 172; ecCodewords = 18; numBlocks = 2;
        } else if (len <= 154) {
            version = 7; moduleCount = 45; totalCodewords = 196; ecCodewords = 20; numBlocks = 2;
        } else {
            return null; // URL too long
        }

        const dataCodewords = totalCodewords - ecCodewords * numBlocks;

        // Build data bitstream
        const bits = [];
        const pushBits = (val, count) => {
            for (let i = count - 1; i >= 0; i--) bits.push((val >> i) & 1);
        };

        // Mode indicator: byte mode = 0100
        pushBits(4, 4);
        // Character count (8 bits for versions 1-9 in byte mode)
        pushBits(len, 8);
        // Data
        for (let i = 0; i < len; i++) pushBits(data[i], 8);
        // Terminator
        const maxBits = dataCodewords * 8;
        const termLen = Math.min(4, maxBits - bits.length);
        pushBits(0, termLen);
        // Pad to byte boundary
        while (bits.length % 8 !== 0) bits.push(0);
        // Pad codewords
        const padBytes = [0xEC, 0x11];
        let padIdx = 0;
        while (bits.length < maxBits) {
            pushBits(padBytes[padIdx % 2], 8);
            padIdx++;
        }

        // Convert to codewords
        const codewords = [];
        for (let i = 0; i < bits.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] || 0);
            codewords.push(byte);
        }

        // Generate EC codewords using Reed-Solomon
        const ecPerBlock = ecCodewords;
        const allCodewords = [];

        // Split into blocks
        const dataPerBlock = Math.floor(dataCodewords / numBlocks);
        const blocks = [];
        let offset = 0;
        for (let b = 0; b < numBlocks; b++) {
            const blockData = codewords.slice(offset, offset + dataPerBlock);
            offset += dataPerBlock;
            const ec = this._rsEncode(blockData, ecPerBlock);
            blocks.push({ data: blockData, ec: ec });
        }

        // Interleave data codewords
        for (let i = 0; i < dataPerBlock; i++) {
            for (let b = 0; b < numBlocks; b++) {
                allCodewords.push(blocks[b].data[i]);
            }
        }
        // Interleave EC codewords
        for (let i = 0; i < ecPerBlock; i++) {
            for (let b = 0; b < numBlocks; b++) {
                allCodewords.push(blocks[b].ec[i]);
            }
        }

        // Create module matrix
        const modules = Array.from({ length: moduleCount }, () => Array(moduleCount).fill(false));
        const reserved = Array.from({ length: moduleCount }, () => Array(moduleCount).fill(false));

        // Place finder patterns
        this._placeFinderPattern(modules, reserved, 0, 0, moduleCount);
        this._placeFinderPattern(modules, reserved, moduleCount - 7, 0, moduleCount);
        this._placeFinderPattern(modules, reserved, 0, moduleCount - 7, moduleCount);

        // Place alignment patterns (version >= 2)
        if (version >= 2) {
            const alignPos = this._alignmentPositions(version);
            for (const r of alignPos) {
                for (const c of alignPos) {
                    if (reserved[r]?.[c]) continue;
                    this._placeAlignmentPattern(modules, reserved, r, c, moduleCount);
                }
            }
        }

        // Timing patterns
        for (let i = 8; i < moduleCount - 8; i++) {
            if (!reserved[6][i]) { modules[6][i] = i % 2 === 0; reserved[6][i] = true; }
            if (!reserved[i][6]) { modules[i][6] = i % 2 === 0; reserved[i][6] = true; }
        }

        // Dark module
        modules[moduleCount - 8][8] = true;
        reserved[moduleCount - 8][8] = true;

        // Reserve format info areas
        for (let i = 0; i < 8; i++) {
            reserved[8][i] = true;
            reserved[8][moduleCount - 1 - i] = true;
            reserved[i][8] = true;
            reserved[moduleCount - 1 - i][8] = true;
        }
        reserved[8][8] = true;

        // Reserve version info areas (version >= 7)
        if (version >= 7) {
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 3; j++) {
                    reserved[i][moduleCount - 11 + j] = true;
                    reserved[moduleCount - 11 + j][i] = true;
                }
            }
        }

        // Place data
        let bitIndex = 0;
        const dataBits = [];
        for (const cw of allCodewords) {
            for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1);
        }

        let upward = true;
        for (let col = moduleCount - 1; col >= 0; col -= 2) {
            if (col === 6) col = 5; // Skip timing column
            const rows = upward
                ? Array.from({ length: moduleCount }, (_, i) => moduleCount - 1 - i)
                : Array.from({ length: moduleCount }, (_, i) => i);
            for (const row of rows) {
                for (let c = 0; c < 2; c++) {
                    const actualCol = col - c;
                    if (actualCol < 0) continue;
                    if (reserved[row][actualCol]) continue;
                    modules[row][actualCol] = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
                    bitIndex++;
                }
            }
            upward = !upward;
        }

        // Apply mask pattern 0 (checkerboard) and format info
        for (let r = 0; r < moduleCount; r++) {
            for (let c = 0; c < moduleCount; c++) {
                if (!reserved[r][c]) {
                    if ((r + c) % 2 === 0) modules[r][c] = !modules[r][c];
                }
            }
        }

        // Write format info (mask 0, EC level L = 01, mask 000)
        // Format info value for L,mask0 = 0x77C4 after BCH
        const formatBits = [1,1,1,0,1,1,1,1,1,0,0,0,1,0,0];
        // Top-left horizontal
        let fIdx = 0;
        for (let i = 0; i <= 7; i++) {
            const col = i < 6 ? i : i + 1;
            modules[8][col] = formatBits[fIdx] === 1;
            fIdx++;
        }
        // Top-left vertical  
        fIdx = 0;
        for (let i = 0; i <= 7; i++) {
            const row = i < 6 ? moduleCount - 1 - i : moduleCount - i;
            if (row >= 0 && row < moduleCount) modules[row][8] = formatBits[fIdx] === 1;
            fIdx++;
        }
        // Top-right horizontal
        for (let i = 0; i < 7; i++) {
            modules[8][moduleCount - 1 - i] = formatBits[14 - i] === 1;
        }
        // Bottom-left vertical
        for (let i = 0; i < 8; i++) {
            const row = i < 6 ? i : i + 1;
            modules[row][8] = formatBits[14 - i] === 1;
        }

        return modules;
    },

    _placeFinderPattern(modules, reserved, row, col, size) {
        for (let r = -1; r <= 7; r++) {
            for (let c = -1; c <= 7; c++) {
                const mr = row + r, mc = col + c;
                if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
                const isBlack = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                    (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                    (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                modules[mr][mc] = isBlack;
                reserved[mr][mc] = true;
            }
        }
    },

    _placeAlignmentPattern(modules, reserved, centerRow, centerCol, size) {
        for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
                const mr = centerRow + r, mc = centerCol + c;
                if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
                const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
                modules[mr][mc] = isBlack;
                reserved[mr][mc] = true;
            }
        }
    },

    _alignmentPositions(version) {
        const positions = {
            2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
            6: [6, 34], 7: [6, 22, 38],
        };
        return positions[version] || [6, 18];
    },

    /** Reed-Solomon encoding in GF(256) */
    _rsEncode(data, ecCount) {
        // GF(256) with polynomial 0x11D
        const gfExp = new Array(512);
        const gfLog = new Array(256);
        let val = 1;
        for (let i = 0; i < 255; i++) {
            gfExp[i] = val;
            gfLog[val] = i;
            val <<= 1;
            if (val >= 256) val ^= 0x11D;
        }
        for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];

        const gfMul = (a, b) => {
            if (a === 0 || b === 0) return 0;
            return gfExp[gfLog[a] + gfLog[b]];
        };

        // Generator polynomial
        let gen = [1];
        for (let i = 0; i < ecCount; i++) {
            const newGen = new Array(gen.length + 1).fill(0);
            for (let j = 0; j < gen.length; j++) {
                newGen[j] ^= gen[j];
                newGen[j + 1] ^= gfMul(gen[j], gfExp[i]);
            }
            gen = newGen;
        }

        // Polynomial division
        const msg = [...data, ...new Array(ecCount).fill(0)];
        for (let i = 0; i < data.length; i++) {
            const coef = msg[i];
            if (coef !== 0) {
                for (let j = 0; j < gen.length; j++) {
                    msg[i + j] ^= gfMul(gen[j], coef);
                }
            }
        }

        return msg.slice(data.length);
    }
};
