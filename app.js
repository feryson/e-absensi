// --- KONFIGURASI APLIKASI ---
const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbwyaBZ_RW8PpnjXZcAu3Pzi5JAeKyIJ8ydMPtFoUspR4V00CapGwS16orfVUfuTEWPQSw/exec"; // PASTE URL WEB APP APPS SCRIPT ANDA DI SINI
const KANTOR_LAT = -5.300456628608312;
const KANTOR_LNG = 105.03455748021706;
const MAKSIMAL_RADIUS_METER = 25; // Radius toleransi (meter)

// Variabel State
let currentUser = null;
let currentLocation = null;
let stream = null;
let deferredPrompt = null;

// Referensi DOM Element
const dom = {
    secLogin: document.getElementById('login-section'),
    secEmployee: document.getElementById('employee-section'),
    secAdmin: document.getElementById('admin-section'),
    formLogin: document.getElementById('login-form'),
    inpNik: document.getElementById('login-nik'),
    btnLogin: document.getElementById('btn-login'),
    errLogin: document.getElementById('login-error'),
    userInfo: document.getElementById('user-info'),
    dispName: document.getElementById('display-name'),
    dispRole: document.getElementById('display-role'),
    btnLogout: document.getElementById('btn-logout'),
    btnInstallPwa: document.getElementById('btn-install-pwa'),
    selType: document.getElementById('absen-type'),
    conKet: document.getElementById('keterangan-container'),
    inpKet: document.getElementById('absen-keterangan'),
    btnAbsen: document.getElementById('btn-absen'),
    msgAbsen: document.getElementById('absen-message'),
    statLoc: document.getElementById('location-status'),
    bannerLoc: document.getElementById('location-banner'),
    iconLocWrapper: document.getElementById('location-icon-wrapper'),
    video: document.getElementById('video'),
    canvas: document.getElementById('canvas'),
    camPlaceholder: document.getElementById('camera-placeholder'),
    btnStartCam: document.getElementById('btn-start-camera'),
    badgeLive: document.getElementById('live-badge'),
    overlayLoad: document.getElementById('loading-overlay'),
    textLoad: document.getElementById('loading-text')
};

// 1. Inisialisasi Service Worker & Session
window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW error:', err));
    }
    const savedSession = sessionStorage.getItem('e_absensi_session');
    if (savedSession) {
        currentUser = JSON.parse(savedSession);
        renderDashboardBerdasarkanRole();
    }
});

// PWA Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

dom.btnInstallPwa.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') deferredPrompt = null;
    } else {
        alert("Aplikasi bisa diinstal via menu browser (Tambahkan ke Layar Utama/Add to Home Screen).");
    }
});

// Loader Helper
function toggleLoading(show, message = 'Memproses...') {
    dom.textLoad.textContent = message;
    dom.overlayLoad.classList.toggle('hidden', !show);
    dom.overlayLoad.classList.toggle('flex', show);
}

// Rumus Jarak Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180;
    const dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return Math.round(R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))));
}

// Bridge API Cepat
async function fetchBackend(action, params = []) {
    return new Promise((resolve, reject) => {
        if (!URL_APPS_SCRIPT) return reject(new Error("URL Apps Script belum diisi!"));
        const payloadData = { action: action, parameters: params };
        fetch(URL_APPS_SCRIPT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ payload: JSON.stringify(payloadData) })
        })
        .then(res => res.json())
        .then(resolve)
        .catch(() => reject(new Error("Koneksi gagal. Cek internet Anda.")));
    });
}

// Handle Login
dom.formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputNik = dom.inpNik.value.trim();
    if(!inputNik) return;

    dom.errLogin.classList.add('hidden');
    dom.btnLogin.disabled = true;
    toggleLoading(true, 'Memverifikasi...');

    try {
        const response = await fetchBackend('login', [inputNik]);
        if (response.success) {
            currentUser = response.data;
            sessionStorage.setItem('e_absensi_session', JSON.stringify(currentUser));
            renderDashboardBerdasarkanRole();
        } else {
            dom.errLogin.textContent = response.message;
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
    
    if (currentUser.role === 'SUPERADMIN') {
        dom.secAdmin.classList.remove('hidden');
        loadDataPegawaiAdmin();
    } else {
        dom.secEmployee.classList.remove('hidden');
        inisialisasiGPS();
        inisialisasiKamera();
        cekStatusHariIni(); // <--- LOGIKA BARU PEMANGGILAN STATUS
    }
}

// --- LOGIKA BARU: MENGATUR DROPDOWN BERDASARKAN STATUS HARI INI ---
async function cekStatusHariIni() {
    toggleLoading(true, 'Mengecek status absen...');
    try {
        const res = await fetchBackend('checkStatus', [currentUser.nik]);
        if(res.success) {
            aturDropdownBerdasarkanStatus(res.data);
        }
    } catch(e) {
        console.error(e);
        dom.selType.innerHTML = '<option value="">⚠️ Gagal memuat status absen</option>';
    } finally {
        toggleLoading(false);
    }
}

function aturDropdownBerdasarkanStatus(status) {
    dom.selType.innerHTML = '';
    
    if (status.izin) {
        dom.selType.innerHTML = '<option value="">✅ Anda sedang Izin/Cuti hari ini.</option>';
        dom.selType.disabled = true;
        dom.btnAbsen.disabled = true;
    } else if (status.keluar) {
        dom.selType.innerHTML = '<option value="">✅ Anda sudah selesai absen pulang hari ini.</option>';
        dom.selType.disabled = true;
        dom.btnAbsen.disabled = true;
    } else if (status.masuk) {
        dom.selType.innerHTML = '<option value="KELUAR">🏃 Absen Pulang (Clock Out)</option>';
        dom.selType.disabled = false;
    } else {
        dom.selType.innerHTML = `
            <option value="MASUK">✅ Absen Masuk (Clock In)</option>
            <option value="TIDAK_HADIR">📝 Pengajuan Izin / Cuti / Sakit</option>
        `;
        dom.selType.disabled = false;
    }
    validasiStatusAbsensi(); // Cek ulang form & tombol
}

dom.btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem('e_absensi_session');
    location.reload(); // Hard refresh untuk membersihkan semua memori UI
});

// Jam Digital Live
setInterval(() => {
    const elJam = document.getElementById('live-clock');
    if (elJam) elJam.textContent = new Date().toLocaleTimeString('id-ID');
}, 1000);

// Inisialisasi GPS Realtime
function inisialisasiGPS() {
    if (!navigator.geolocation) {
        ubahStatusLokasi('error', 'Browser Anda tidak mendukung lokasi.');
        return;
    }
    navigator.geolocation.watchPosition(
        (pos) => {
            currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            validasiStatusAbsensi();
        },
        (err) => ubahStatusLokasi('error', 'Izin GPS ditolak atau sinyal lemah.'),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
}

function ubahStatusLokasi(tipe, pesan) {
    dom.statLoc.textContent = pesan;
    if (tipe === 'success') {
        dom.bannerLoc.className = "bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-6 text-xs flex items-start gap-3";
        dom.iconLocWrapper.className = "p-2 rounded-xl bg-emerald-100 text-emerald-600 shrink-0";
        dom.statLoc.className = "text-emerald-700 font-bold";
    } else if (tipe === 'error') {
        dom.bannerLoc.className = "bg-rose-50 border border-rose-200 rounded-2xl p-4 mb-6 text-xs flex items-start gap-3";
        dom.iconLocWrapper.className = "p-2 rounded-xl bg-rose-100 text-rose-600 shrink-0";
        dom.statLoc.className = "text-rose-700 font-bold";
    } else {
        dom.bannerLoc.className = "bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 text-xs flex items-start gap-3";
        dom.iconLocWrapper.className = "p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0";
        dom.statLoc.className = "text-blue-700 font-medium";
    }
}

// Inisialisasi Kamera Depan
async function inisialisasiKamera() {
    dom.camPlaceholder.classList.remove('hidden');
    dom.video.classList.add('hidden');
    dom.btnStartCam.classList.add('hidden');
    dom.badgeLive.classList.add('hidden');

    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } } });
        dom.video.srcObject = stream;
        dom.video.onloadedmetadata = () => {
            dom.camPlaceholder.classList.add('hidden');
            dom.video.classList.remove('hidden');
            dom.badgeLive.classList.remove('hidden');
            dom.badgeLive.classList.add('flex');
            validasiStatusAbsensi();
        };
    } catch (e) {
        dom.camPlaceholder.innerHTML = '<span class="text-rose-500 font-bold text-xs"><i class="fa-solid fa-camera-slash mb-2 block"></i>Kamera Ditolak</span>';
        dom.btnStartCam.classList.remove('hidden');
    }
}
dom.btnStartCam.addEventListener('click', inisialisasiKamera);

// Validasi Form & Tombol Absen
function validasiStatusAbsensi() {
    const tipeAbsen = dom.selType.value;
    const isKameraAktif = stream !== null && dom.video.srcObject !== null;

    if (!tipeAbsen) {
        dom.btnAbsen.disabled = true;
        dom.conKet.classList.add('hidden');
        return;
    }

    if (tipeAbsen === 'TIDAK_HADIR') {
        dom.conKet.classList.remove('hidden');
        ubahStatusLokasi('success', 'Mode Izin: GPS dilewati. Wajib isi keterangan & foto.');
        dom.btnAbsen.disabled = !(dom.inpKet.value.trim().length > 0 && isKameraAktif);
    } else {
        dom.conKet.classList.add('hidden');
        if (!currentLocation) { dom.btnAbsen.disabled = true; return; }

        const jarak = calculateDistance(KANTOR_LAT, KANTOR_LNG, currentLocation.lat, currentLocation.lng);
        let gpsValid = false;

        if (jarak <= MAKSIMAL_RADIUS_METER) {
            ubahStatusLokasi('success', `Anda di area kantor (Jarak: ${jarak}m).`);
            gpsValid = true;
        } else {
            ubahStatusLokasi('error', `Di luar area. Jarak: ${jarak}m (Maksimal: ${MAKSIMAL_RADIUS_METER}m)`);
            gpsValid = false;
        }

        dom.btnAbsen.disabled = !(gpsValid && isKameraAktif);
    }
}

dom.selType.addEventListener('change', validasiStatusAbsensi);
dom.inpKet.addEventListener('input', validasiStatusAbsensi);

// Kompresi Foto Ekstra Ringan -> Cepat
function ambilFotoSelfie() {
    if (!stream) return "";
    try {
        const ctx = dom.canvas.getContext('2d');
        dom.canvas.width = 400;
        dom.canvas.height = 300;
        ctx.translate(dom.canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(dom.video, 0, 0, dom.canvas.width, dom.canvas.height);
        return dom.canvas.toDataURL('image/jpeg', 0.4); 
    } catch(e) { return ""; }
}

// Eksekusi Absensi
dom.btnAbsen.addEventListener('click', async () => {
    dom.btnAbsen.disabled = true;
    const payloadData = {
        nik: currentUser.nik,
        nama: currentUser.nama,
        type: dom.selType.value,
        lat: currentLocation ? currentLocation.lat : 0,
        lng: currentLocation ? currentLocation.lng : 0,
        keterangan: dom.inpKet.value.trim(),
        photo: ambilFotoSelfie()
    };

    toggleLoading(true, 'Mengirim data ke server...');
    dom.msgAbsen.classList.add('hidden');

    try {
        const response = await fetchBackend('submitAbsensi', [payloadData]);
        if (response.success) {
            dom.msgAbsen.textContent = `✅ Berhasil Disimpan! (${response.time})`;
            dom.msgAbsen.className = "text-center text-xs font-bold mt-4 p-4 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200";
            dom.msgAbsen.classList.remove('hidden');
            dom.inpKet.value = '';
            
            // Re-check status hari ini agar opsi berubah secara instan
            cekStatusHariIni(); 
        } else { throw new Error(response.message); }
    } catch (err) {
        dom.msgAbsen.textContent = `⚠️ ${err.message}`;
        dom.msgAbsen.className = "text-center text-xs font-bold mt-4 p-4 rounded-2xl bg-rose-50 text-rose-700 border border-rose-200";
        dom.msgAbsen.classList.remove('hidden');
    } finally {
        toggleLoading(false);
        validasiStatusAbsensi();
    }
});

// ADMIN NAVIGASI TAB (Sama dengan Versi Sebelumnya, disingkat untuk fokus UI)
const tabPegawai = document.getElementById('tab-pegawai');
const tabLaporan = document.getElementById('tab-laporan');
const panelPegawai = document.getElementById('panel-pegawai');
const panelLaporan = document.getElementById('panel-laporan');

tabPegawai.addEventListener('click', () => {
    panelPegawai.classList.remove('hidden');
    panelLaporan.classList.add('hidden');
    tabPegawai.className = "flex-1 md:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-xl font-bold text-xs shadow-sm transition";
    tabLaporan.className = "flex-1 md:flex-none px-5 py-2.5 text-slate-500 hover:text-slate-700 rounded-xl font-bold text-xs transition";
    loadDataPegawaiAdmin();
});

tabLaporan.addEventListener('click', () => {
    panelPegawai.classList.add('hidden');
    panelLaporan.classList.remove('hidden');
    tabLaporan.className = "flex-1 md:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-xl font-bold text-xs shadow-sm transition";
    tabPegawai.className = "flex-1 md:flex-none px-5 py-2.5 text-slate-500 hover:text-slate-700 rounded-xl font-bold text-xs transition";
});

async function loadDataPegawaiAdmin() {
    const tbody = document.getElementById('table-pegawai-body');
    tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-slate-400">Memuat...</td></tr>';
    try {
        const data = await fetchBackend('getPegawai', []);
        tbody.innerHTML = '';
        data.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-5 py-3.5 font-bold">${p.nik}</td>
                <td class="px-5 py-3.5">${p.nama}</td>
                <td class="px-5 py-3.5"><span class="px-2 bg-blue-100 text-blue-700 rounded">${p.role}</span></td>
                <td class="px-5 py-3.5 text-right"><button onclick="hapusPegawai('${p.nik}')" class="text-rose-500">Hapus</button></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) { tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-rose-500 font-bold">Gagal memuat</td></tr>'; }
}

window.hapusPegawai = async function(nik) {
    if (confirm(`Hapus NIK ${nik}?`)) {
        toggleLoading(true, 'Menghapus...');
        await fetchBackend('deletePegawai', [nik]);
        toggleLoading(false);
        loadDataPegawaiAdmin();
    }
};

document.getElementById('btn-filter').addEventListener('click', async () => {
    const tgl = document.getElementById('filter-date').value;
    if (!tgl) return;
    const tbody = document.getElementById('table-laporan-body');
    tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-slate-400">Memuat laporan...</td></tr>';
    try {
        const data = await fetchBackend('getLaporan', [tgl]);
        tbody.innerHTML = '';
        data.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-5 py-3.5 font-bold">${d.waktu}</td>
                <td class="px-5 py-3.5">${d.nik}</td>
                <td class="px-5 py-3.5">${d.nama}</td>
                <td class="px-5 py-3.5 font-bold text-blue-600">${d.tipe}</td>
                <td class="px-5 py-3.5">${d.jarak ? d.jarak + 'm' : '-'}</td>
                <td class="px-5 py-3.5">${d.keterangan || '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) { tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-rose-500">Error</td></tr>'; }
});