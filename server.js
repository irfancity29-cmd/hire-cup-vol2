const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Masukkan API Key / API Key Uji WaroengPay Anda di sini
const WAROENG_API_KEY = 'wp_live__W4sG2fzj9Zfpmw6mRVWOUV-6HopikgtiKEXZKsZdkE';

// Endpoint membuat tagihan sesuai dokumentasi WaroengPay dengan redirectUrl yang otomatis menyesuaikan domain
app.post('/api/create-transaction', async (req, res) => {
    try {
        const { teamName, captainWa, fee } = req.body;
        const referenceId = 'INV-' + Date.now();

        // Mendeteksi domain secara otomatis (baik di Railway maupun di Localhost)
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}`;

        const payload = {
            amount: Number(fee),
            reference: referenceId,
            description: `Pendaftaran Turnamen HIRE CUP Vol 2 - Tim ${teamName}`,
            redirect_url: `${baseUrl}/?success=true&ref=${referenceId}` // <--- Otomatis mengikuti domain saat ini
        };

        const response = await fetch('https://waroengpay.com/api/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${WAROENG_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("Respons WaroengPay:", data); // Membantu melihat struktur respons jika terjadi kendala
        
        // Deteksi fleksibel berbagai format key URL pembayaran dari API WaroengPay
        const paymentUrl = data.pay_url || data.payUrl || data.payment_url || data.paymentUrl || data.url;
        
        if (response.ok && paymentUrl) {
            res.json({ 
                paymentUrl: paymentUrl, 
                orderId: referenceId 
            });
        } else {
            throw new Error(data.error || data.message || 'Gagal membuat tagihan di WaroengPay');
        }
    } catch (error) {
        console.error("WaroengPay Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint untuk menyimpan data ke Google Sheets
app.post('/api/save-to-sheet', async (req, res) => {
    try {
        const { teamName, whatsapp, players } = req.body;
        const payload = {
            teamName: teamName,
            whatsapp: whatsapp,
            player1: players[0] || "",
            player2: players[1] || "",
            player3: players[2] || "",
            player4: players[3] || "",
            player5: players[4] || "",
            player6: players[5] || "-",
            player7: players[6] || "-",
            status: "Lunas"
        };
        const googleSheetUrl = 'https://script.google.com/macros/s/AKfycbwaW0WSKHJZ_FjRoyTMrn-IoKwEfQblFVSere5PBQ3PGaCzOe_CfWRGMY22t8wXsrdkjA/exec';
        await fetch(googleSheetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint untuk mengambil daftar tim dengan pemetaan data yang akurat
app.get('/api/teams', async (req, res) => {
    try {
        const googleSheetUrl = 'https://script.google.com/macros/s/AKfycbwaW0WSKHJZ_FjRoyTMrn-IoKwEfQblFVSere5PBQ3PGaCzOe_CfWRGMY22t8wXsrdkjA/exec';
        const response = await fetch(googleSheetUrl);
        const textResult = await response.text();
        const rawData = JSON.parse(textResult);

        // Ubah struktur data agar benar-benar mengambil Kolom B (Nama Tim)
        const teams = rawData.map(row => {
            let name = "";
            let stat = "Lunas";

            if (Array.isArray(row)) {
                name = row[1] || row[0]; 
                stat = row[10] || row[row.length - 1] || "Lunas";
            } else if (typeof row === 'object' && row !== null) {
                name = row.teamName || row.name || row[Object.keys(row)[1]] || Object.values(row)[1];
                stat = row.status || "Lunas";
            }

            return {
                teamName: name,
                status: stat
            };
        }).filter(t => t.teamName && !t.teamName.toString().includes('Timestamp') && !t.teamName.toString().includes('2026-10-06T'));

        res.json(teams);
    } catch (error) {
        console.error("Fetch Teams Error:", error);
        res.json([]);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});