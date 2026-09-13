// --- KONFIGURASI APLIKASI ---
const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbwyaBZ_RW8PpnjXZcAu3Pzi5JAeKyIJ8ydMPtFoUspR4V00CapGwS16orfVUfuTEWPQSw/exec"; // PASTE URL WEB APP APPS SCRIPT ANDA DI SINI
const KANTOR_LAT = -5.300456628608312;
const KANTOR_LNG = 105.03455748021706;
const MAKSIMAL_RADIUS_METER = 25; // Radius toleransi (meter)

// Variabel State
let currentUser = null;
let currentLocation = null;
let stream = null;
let deferredPrompt = null; // Untuk PWA Install Prompt

// Elemen DOM (Mencegah pencarian berulang)
const dom = {
    secLogin: document.getElementById('login-section'),
    secEmployee: document.getElementById('employee-section'),
    secAdmin: document.getElementById('admin-section'),
    
    // Login Elements
    formLogin: document.getElementById('login-form'),
    inpNik: document.getElementById('login-nik'),
    btnLogin: document.getElementById('btn-login'),
    errLogin: document.getElementById('login-error'),
    
    // Header
    userInfo: document.getElementById('user-info'),
    dispName: document.getElementById('display-name'),
    dispRole: document.getElementById('display-role'),
    btnLogout: document.getElementById('btn-logout'),
    btnInstallPwa: document.getElementById('btn-install-pwa'),
    
    // Absensi Elements
    selType: document.getElementById('absen-type'),
    conKet: document.getElementById('keterangan-container'),
    inpKet: document.getElementById('absen-keterangan'),
    btnAbsen: document.getElementById('btn-absen'),
    msgAbsen: document.getElementById('absen-message'),
    statLoc: document.getElementById('location-status'),
    bannerLoc: document.getElementById('location-banner'),
    iconLocWrapper: document.getElementById('location-icon-wrapper'),
    
    // Camera Elements
    video: document.getElementById('video'),
    canvas: document.getElementById('canvas'),
    camPlaceholder: document.getElementById('camera-placeholder'),
    btnStartCam: document.getElementById('btn-start-camera'),
    badgeLive: document.getElementById('live-badge'),
    
    // Overlay Loading & Modal
    overlayLoad: document.getElementById('loading-overlay'),
    textLoad: document.getElementById('loading-text'),
    modalInstall: document.getElementById('modal-install'),
    closeInstall: document.getElementById('btn-close-install-modal'),
    instPwa: document.getElementById('install-instructions')
};

// 1. Inisialisasi Service Worker & Session
window.addEventListener('load', () => {
    // Daftarkan Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Registration failed:', err));
    }

    // Cek apakah user sudah login sebelumnya (Anti-Lemot)
    const savedSession = sessionStorage.getItem('e_absensi_session');
    if (savedSession) {
        currentUser = JSON.parse(savedSession);
        renderDashboardBerdasarkanRole();
    }
});

// 2. Tangkap Event PWA Install
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Mencegah banner default muncul
    deferredPrompt = e;
    dom.btnInstallPwa.classList.remove('hidden');
    dom.btnInstallPwa.classList.add('flex');
});

// 3. Tombol Install PWA Diklik
dom.btnInstallPwa.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            dom.btnInstallPwa.classList.add('hidden');
        }
        deferredPrompt = null;
    } else {
        // Fallback untuk iOS / Browser yang tidak mendukung prompt otomatis
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        let html = '';
        if (isIOS) {
            html = `<ol class="list-decimal pl-4 space-y-2">
                <li>Ketuk ikon bagikan <i class="fa-solid fa-arrow-up-from-bracket mx-1"></i> di bar bawah browser.</li>
                <li>Gulir ke bawah dan pilih <b class="text-blue-600">"Add to Home Screen"</b>.</li>
                <li>Ketuk <b>Add</b> di pojok kanan atas.</li>
            </ol>`;
        } else {
            html = `<p>Tekan menu pengaturan browser (titik tiga) lalu pilih <b>Install App</b> atau <b>Tambahkan ke Layar Utama</b>.</p>`;
        }
        dom.instPwa.innerHTML = html;
        dom.modalInstall.classList.remove('hidden');
    }
});

dom.closeInstall.addEventListener('click', () => {
    dom.modalInstall.classList.add('hidden');
});

// Fungsi Loading Overlay
function toggleLoading(show, message = 'Memproses...') {
    if (show) {
        dom.textLoad.textContent = message;
        dom.overlayLoad.classList.remove('hidden');
    } else {
        dom.overlayLoad.classList.add('hidden');
    }
}

// Rumus Jarak Harvesine
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radius bumi dalam meter
    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180;
    const dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return Math.round(R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))));
}

// Jembatan Asinkron ke Google Apps Script
async function fetchBackend(action, params = []) {
    return new Promise((resolve, reject) => {
        // Jika berjalan langsung di lingkungan Apps Script
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(resolve)
                .withFailureHandler(reject)
                [action].apply(null, params);
        } 
        // Jika berjalan di hosting eksternal (Github Pages)
        else if (URL_APPS_SCRIPT) {
            const payloadData = { action: action, parameters: params };
            fetch(URL_APPS_SCRIPT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ payload: JSON.stringify(payloadData) })
            })
            .then(res => res.json())
            .then(resolve)
            .catch(() => reject(new Error("Gagal terhubung ke database. Periksa koneksi internet atau URL API Anda.")));
        } else {
            reject(new Error("URL Apps Script kosong! Pastikan konfigurasi URL_APPS_SCRIPT diisi di app.js."));
        }
    });
}

dom.formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputNik = dom.inpNik.value.trim();
    if(!inputNik) return;

    dom.errLogin.classList.add('hidden');
    dom.btnLogin.disabled = true;
    toggleLoading(true, 'Memverifikasi NIK...');

    try {
        const response = await fetchBackend('login', [inputNik]);
        
        if (response.success) {
            currentUser = response.data;
            // Simpan session agar tidak perlu login ulang saat di-refresh
            sessionStorage.setItem('e_absensi_session', JSON.stringify(currentUser));
            renderDashboardBerdasarkanRole();
        } else {
            dom.errLogin.textContent = response.message || "NIK Tidak Ditemukan!";
            dom.errLogin.classList.remove('hidden');
        }
    } catch (err) {
        dom.errLogin.textContent = err.message;
        dom.errLogin.classList.remove('hidden');
    } finally {
        toggleLoading(false);
        dom.btnLogin.disabled = false;
    }
});

function renderDashboardBerdasarkanRole() {
    dom.dispName.textContent = currentUser.nama;
    dom.dispRole.textContent = currentUser.role;
    dom.userInfo.classList.remove('hidden');
    dom.userInfo.classList.add('flex');
    dom.secLogin.classList.add('hidden');
    
    if (currentUser.role.toUpperCase() === 'SUPERADMIN') {
        dom.secAdmin.classList.remove('hidden');
        loadDataPegawaiAdmin(); // Langsung load data
    } else {
        dom.secEmployee.classList.remove('hidden');
        inisialisasiGPS();
        inisialisasiKamera();
    }
}

dom.btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem('e_absensi_session');
    currentUser = null;
    currentLocation = null;
    
    // Matikan Kamera
    if (stream) stream.getTracks().forEach(track => track.stop());
    dom.video.classList.add('hidden');
    dom.badgeLive.classList.add('hidden');
    
    // Reset UI
    dom.userInfo.classList.add('hidden');
    dom.secEmployee.classList.add('hidden');
    dom.secAdmin.classList.add('hidden');
    dom.secLogin.classList.remove('hidden');
    dom.inpNik.value = '';
    dom.btnAbsen.disabled = true;
});


// Jam Digital Live
setInterval(() => {
    const elJam = document.getElementById('live-clock');
    if (elJam) elJam.textContent = new Date().toLocaleTimeString('id-ID');
}, 1000);

// Inisialisasi GPS (Dijalankan hanya untuk Pegawai)
function inisialisasiGPS() {
    if (!navigator.geolocation) {
        ubahStatusLokasi('error', 'Browser/HP Anda tidak mendukung GPS.');
        return;
    }

    navigator.geolocation.watchPosition(
        (pos) => {
            currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            validasiStatusAbsensi(); // Cek ulang ketersediaan tombol setiap ada pergerakan
        },
        (err) => {
            ubahStatusLokasi('error', 'Akses GPS ditolak / Gagal melacak lokasi.');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
}

function ubahStatusLokasi(tipe, pesan) {
    dom.statLoc.textContent = pesan;
    if (tipe === 'success') {
        dom.bannerLoc.className = "bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6 text-xs flex items-start gap-3";
        dom.iconLocWrapper.className = "p-2 rounded-lg bg-emerald-100 text-emerald-600 shrink-0";
        dom.statLoc.className = "text-emerald-700 font-bold";
    } else if (tipe === 'error') {
        dom.bannerLoc.className = "bg-rose-50 border border-rose-200 rounded-xl p-4 mb-6 text-xs flex items-start gap-3";
        dom.iconLocWrapper.className = "p-2 rounded-lg bg-rose-100 text-rose-600 shrink-0";
        dom.statLoc.className = "text-rose-700 font-bold";
    } else { // Warning / Searching
        dom.bannerLoc.className = "bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-xs flex items-start gap-3";
        dom.iconLocWrapper.className = "p-2 rounded-lg bg-amber-100 text-amber-600 shrink-0";
        dom.statLoc.className = "text-amber-700 font-medium";
    }
}

// Inisialisasi Kamera Depan
async function inisialisasiKamera() {
    dom.camPlaceholder.classList.remove('hidden');
    dom.video.classList.add('hidden');
    dom.btnStartCam.classList.add('hidden');
    dom.badgeLive.classList.add('hidden');

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 } }
        });
        dom.video.srcObject = stream;
        dom.video.onloadedmetadata = () => {
            dom.camPlaceholder.classList.add('hidden');
            dom.video.classList.remove('hidden');
            dom.badgeLive.classList.remove('hidden');
            dom.badgeLive.classList.add('flex');
            validasiStatusAbsensi();
        };
    } catch (e) {
        dom.camPlaceholder.innerHTML = '<span class="text-rose-500 font-bold text-xs"><i class="fa-solid fa-camera-slash text-xl mb-2 block"></i>Kamera Ditolak / Tidak Tersedia</span>';
        dom.btnStartCam.classList.remove('hidden');
    }
}
dom.btnStartCam.addEventListener('click', inisialisasiKamera);


// FIX: Fungsi Kunci Validasi Form (Sangat Penting untuk Logika Izin)
function validasiStatusAbsensi() {
    const tipeAbsen = dom.selType.value;
    const isKameraAktif = stream !== null && dom.video.srcObject !== null;

    if (tipeAbsen === 'TIDAK_HADIR') {
        // MODE IZIN / SAKIT / CUTI
        dom.conKet.classList.remove('hidden');
        ubahStatusLokasi('warning', 'Mode Izin Aktif. Jarak GPS & Kamera diabaikan.');
        
        // Logika: Tombol aktif JIKA DAN HANYA JIKA keterangan sudah diketik.
        const keteranganVal = dom.inpKet.value.trim();
        dom.btnAbsen.disabled = keteranganVal.length === 0;
        
    } else {
        // MODE MASUK / KELUAR NORMAL (Wajib GPS & Kamera)
        dom.conKet.classList.add('hidden');
        
        if (!currentLocation) {
            dom.btnAbsen.disabled = true;
            return;
        }

        // Kalkulasi Jarak Asli
        const jarak = calculateDistance(KANTOR_LAT, KANTOR_LNG, currentLocation.lat, currentLocation.lng);
        let gpsValid = false;

        if (jarak <= MAKSIMAL_RADIUS_METER) {
            ubahStatusLokasi('success', `Anda berada di area kantor. (Jarak: ${jarak}m)`);
            gpsValid = true;
        } else {
            ubahStatusLokasi('error', `Anda di luar radius. Jarak Anda: ${jarak}m (Batas: ${MAKSIMAL_RADIUS_METER}m)`);
            gpsValid = false;
        }

        // Logika: Tombol aktif JIKA GPS Masuk Area DAN Kamera Aktif
        dom.btnAbsen.disabled = !(gpsValid && isKameraAktif);
    }
}

// Event Listeners agar tombol reaktif saat pengguna mengetik/memilih
dom.selType.addEventListener('change', validasiStatusAbsensi);
dom.inpKet.addEventListener('input', validasiStatusAbsensi); // Memicu pengecekan tiap kali ngetik

// Pengambilan Gambar
function ambilFotoSelfie() {
    if (!stream) return ""; // Jika tidak ada kamera (misal mode izin), kembalikan string kosong
    try {
        const ctx = dom.canvas.getContext('2d');
        dom.canvas.width = dom.video.videoWidth;
        dom.canvas.height = dom.video.videoHeight;
        ctx.translate(dom.canvas.width, 0);
        ctx.scale(-1, 1); // Mirror 
        ctx.drawImage(dom.video, 0, 0, dom.canvas.width, dom.canvas.height);
        return dom.canvas.toDataURL('image/jpeg', 0.6); // Kompresi 60% agar cepat upload
    } catch(e) {
        return "";
    }
}

// Eksekusi Absensi
dom.btnAbsen.addEventListener('click', async () => {
    // Kunci tombol langsung untuk mencegah Double Click
    dom.btnAbsen.disabled = true;
    
    const tipeAbsen = dom.selType.value;
    const base64Foto = (tipeAbsen !== 'TIDAK_HADIR') ? ambilFotoSelfie() : ""; // Izin tidak wajib foto
    
    const payloadData = {
        nik: currentUser.nik,
        nama: currentUser.nama,
        type: tipeAbsen,
        lat: currentLocation ? currentLocation.lat : 0,
        lng: currentLocation ? currentLocation.lng : 0,
        keterangan: dom.inpKet.value.trim(),
        photo: base64Foto
    };

    toggleLoading(true, 'Mengirim data ke server...');
    dom.msgAbsen.classList.add('hidden');

    try {
        const response = await fetchBackend('submitAbsensi', [payloadData]);
        if (response.success) {
            // Sukses
            dom.msgAbsen.textContent = `Absensi Berhasil! (${response.time})`;
            dom.msgAbsen.className = "text-center text-xs font-bold mt-4 p-4 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 animate-fade-in";
            dom.msgAbsen.classList.remove('hidden');
            dom.inpKet.value = ''; // Reset Form
            setTimeout(() => dom.msgAbsen.classList.add('hidden'), 5000);
        } else {
            throw new Error(response.message);
        }
    } catch (err) {
        // Gagal
        dom.msgAbsen.textContent = `Gagal: ${err.message}`;
        dom.msgAbsen.className = "text-center text-xs font-bold mt-4 p-4 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 animate-fade-in";
        dom.msgAbsen.classList.remove('hidden');
    } finally {
        toggleLoading(false);
        validasiStatusAbsensi(); // Buka kembali tombol sesuai kondisi
    }
});


const tabPegawai = document.getElementById('tab-pegawai');
const tabLaporan = document.getElementById('tab-laporan');
const panelPegawai = document.getElementById('panel-pegawai');
const panelLaporan = document.getElementById('panel-laporan');

tabPegawai.addEventListener('click', () => {
    panelPegawai.classList.remove('hidden');
    panelLaporan.classList.add('hidden');
    tabPegawai.className = "flex-1 md:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-lg font-bold text-xs shadow-sm transition";
    tabLaporan.className = "flex-1 md:flex-none px-5 py-2.5 text-slate-500 hover:text-slate-700 rounded-lg font-bold text-xs transition";
    loadDataPegawaiAdmin();
});

tabLaporan.addEventListener('click', () => {
    panelPegawai.classList.add('hidden');
    panelLaporan.classList.remove('hidden');
    tabLaporan.className = "flex-1 md:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-lg font-bold text-xs shadow-sm transition";
    tabPegawai.className = "flex-1 md:flex-none px-5 py-2.5 text-slate-500 hover:text-slate-700 rounded-lg font-bold text-xs transition";
    if(!document.getElementById('filter-date').value) {
        document.getElementById('filter-date').value = new Date().toISOString().split('T')[0];
    }
});

async function loadDataPegawaiAdmin() {
    const tbody = document.getElementById('table-pegawai-body');
    tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-slate-500"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Mengambil data...</td></tr>';
    try {
        const data = await fetchBackend('getPegawai', []);
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-slate-500">Belum ada karyawan.</td></tr>';
            return;
        }
        data.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition";
            
            const badgeRole = p.role.toUpperCase() === 'SUPERADMIN' 
                ? '<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-extrabold border border-amber-200">ADMIN</span>' 
                : '<span class="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-extrabold border border-blue-200">PEGAWAI</span>';
                
            tr.innerHTML = `
                <td class="px-5 py-3 font-bold text-slate-800">${p.nik}</td>
                <td class="px-5 py-3 text-slate-600">${p.nama}</td>
                <td class="px-5 py-3">${badgeRole}</td>
                <td class="px-5 py-3 text-right">
                    <button onclick="editPegawai('${p.nik}', '${p.nama}', '${p.role}')" class="text-blue-500 hover:text-blue-700 mr-3"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button onclick="hapusPegawai('${p.nik}')" class="text-rose-500 hover:text-rose-700 ${p.nik === currentUser.nik ? 'hidden' : ''}"><i class="fa-solid fa-trash-can"></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-rose-500 font-bold">Gagal memuat database.</td></tr>';
    }
}

// Manajemen Modal Karyawan
const modalPegawai = document.getElementById('modal-pegawai');
document.getElementById('btn-tambah-pegawai').addEventListener('click', () => {
    document.getElementById('form-mode').value = 'add';
    document.getElementById('modal-title').textContent = 'Tambah Karyawan';
    document.getElementById('form-pegawai').reset();
    modalPegawai.classList.remove('hidden');
});
document.getElementById('btn-close-modal').addEventListener('click', () => modalPegawai.classList.add('hidden'));

window.editPegawai = function(nik, nama, role) {
    document.getElementById('form-mode').value = 'edit';
    document.getElementById('original-nik').value = nik;
    document.getElementById('modal-title').textContent = 'Edit Data Karyawan';
    document.getElementById('pegawai-nik').value = nik;
    document.getElementById('pegawai-nama').value = nama;
    document.getElementById('pegawai-role').value = role.toUpperCase();
    modalPegawai.classList.remove('hidden');
};

window.hapusPegawai = async function(nik) {
    if (confirm(`Yakin ingin menghapus NIK ${nik} secara permanen?`)) {
        toggleLoading(true, 'Menghapus data...');
        try {
            await fetchBackend('deletePegawai', [nik]);
            loadDataPegawaiAdmin();
        } catch(e) { alert('Gagal menghapus data.'); }
        finally { toggleLoading(false); }
    }
};

document.getElementById('form-pegawai').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.getElementById('form-mode').value;
    const oldNik = document.getElementById('original-nik').value;
    const payload = {
        nik: document.getElementById('pegawai-nik').value.trim(),
        nama: document.getElementById('pegawai-nama').value.trim(),
        role: document.getElementById('pegawai-role').value
    };

    modalPegawai.classList.add('hidden');
    toggleLoading(true, 'Menyimpan ke database...');

    try {
        const res = mode === 'add' ? await fetchBackend('addPegawai', [payload]) : await fetchBackend('updatePegawai', [oldNik, payload]);
        if (res.success) loadDataPegawaiAdmin();
        else alert(res.message);
    } catch (e) { alert("Terjadi kesalahan server."); }
    finally { toggleLoading(false); }
});

// Fitur Laporan Lanjut & Cetak
document.getElementById('btn-filter').addEventListener('click', async () => {
    const tgl = document.getElementById('filter-date').value;
    if (!tgl) { alert("Pilih tanggal dulu!"); return; }
    
    const tbody = document.getElementById('table-laporan-body');
    tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Mencari Laporan...</td></tr>';
    
    try {
        const data = await fetchBackend('getLaporan', [tgl]);
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500">Tidak ada presensi pada tanggal ini.</td></tr>';
            return;
        }
        data.forEach(d => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50";
            
            // Pewarnaan Badge Status
            let statColor = "bg-blue-100 text-blue-700 border-blue-200";
            if(d.tipe === "KELUAR") statColor = "bg-amber-100 text-amber-700 border-amber-200";
            if(d.tipe === "TIDAK_HADIR") statColor = "bg-slate-200 text-slate-700 border-slate-300";

            tr.innerHTML = `
                <td class="px-5 py-3 font-semibold text-slate-800">${d.waktu}</td>
                <td class="px-5 py-3 font-bold">${d.nik}</td>
                <td class="px-5 py-3 text-slate-700">${d.nama}</td>
                <td class="px-5 py-3"><span class="px-2 py-1 rounded text-[10px] font-bold border ${statColor}">${d.tipe.replace('_', ' ')}</span></td>
                <td class="px-5 py-3 text-slate-600">${d.jarak ? d.jarak + ' m' : '-'}</td>
                <td class="px-5 py-3 text-xs max-w-[150px] truncate text-slate-500" title="${d.keterangan}">${d.keterangan || '-'}</td>
                <td class="px-5 py-3">${d.fotoUrl ? `<a href="${d.fotoUrl}" target="_blank" class="text-blue-600 hover:underline font-bold"><i class="fa-solid fa-link"></i> Buka Foto</a>` : '<span class="text-slate-400">-</span>'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-rose-500 font-bold">Koneksi Timeout / Gagal.</td></tr>';
    }
});

document.getElementById('btn-print').addEventListener('click', () => {
    const tgl = document.getElementById('filter-date').value;
    if(!tgl) { alert("Pilih tanggal dan tampilkan data terlebih dahulu sebelum mencetak."); return; }
    document.getElementById('print-date-info').textContent = `Rekapitulasi Tanggal: ${tgl}`;
    window.print();
});