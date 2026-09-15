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
    
    // Login Elements
    formLogin: document.getElementById('login-form'),
    inpNik: document.getElementById('login-nik'),
    btnLogin: document.getElementById('btn-login'),
    errLogin: document.getElementById('login-error'),
    
    // Header Elements
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
    
    // Modals & Overlay
    overlayLoad: document.getElementById('loading-overlay'),
    textLoad: document.getElementById('loading-text'),
    modalInstall: document.getElementById('modal-install'),
    closeInstall: document.getElementById('btn-close-install-modal'),
    instPwa: document.getElementById('install-instructions')
};

// 1. Inisialisasi Service Worker & Session
window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Registration error:', err));
    }

    const savedSession = sessionStorage.getItem('e_absensi_session');
    if (savedSession) {
        currentUser = JSON.parse(savedSession);
        renderDashboardBerdasarkanRole();
    }
});

// 2. Event PWA Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    dom.btnInstallPwa.classList.remove('hidden');
});

dom.btnInstallPwa.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            dom.btnInstallPwa.classList.add('hidden');
        }
        deferredPrompt = null;
    } else {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        let html = isIOS 
            ? `<ol class="list-decimal pl-4 space-y-2">
                <li>Ketuk ikon bagikan <i class="fa-solid fa-arrow-up-from-bracket mx-1"></i> di Safari.</li>
                <li>Pilih <b class="text-blue-600">"Tambah ke Layar Utama"</b>.</li>
                <li>Ketuk <b>Tambah</b> di sudut kanan atas.</li>
               </ol>`
            : `<p>Buka menu titik tiga di browser Anda, lalu pilih <b>Tambahkan ke Layar Utama</b> atau <b>Install Aplikasi</b>.</p>`;
        
        dom.instPwa.innerHTML = html;
        dom.modalInstall.classList.remove('hidden');
    }
});

dom.closeInstall.addEventListener('click', () => dom.modalInstall.classList.add('hidden'));

// Loader Helper
function toggleLoading(show, message = 'Memproses...') {
    if (show) {
        dom.textLoad.textContent = message;
        dom.overlayLoad.classList.remove('hidden');
    } else {
        dom.overlayLoad.classList.add('hidden');
    }
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

// Bridge API Asinkron Fast-Response
async function fetchBackend(action, params = []) {
    return new Promise((resolve, reject) => {
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(resolve)
                .withFailureHandler(reject)
                [action].apply(null, params);
        } else if (URL_APPS_SCRIPT) {
            const payloadData = { action: action, parameters: params };
            fetch(URL_APPS_SCRIPT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ payload: JSON.stringify(payloadData) })
            })
            .then(res => res.json())
            .then(resolve)
            .catch(() => reject(new Error("Gagal terhubung ke database. Periksa koneksi internet.")));
        } else {
            reject(new Error("URL Apps Script belum diisi di app.js!"));
        }
    });
}

// Handle Login
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
        loadDataPegawaiAdmin();
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
    
    if (stream) stream.getTracks().forEach(track => track.stop());
    dom.video.classList.add('hidden');
    dom.badgeLive.classList.add('hidden');
    
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

// Inisialisasi GPS Realtime
function inisialisasiGPS() {
    if (!navigator.geolocation) {
        ubahStatusLokasi('error', 'Browser/HP Anda tidak mendukung fitur lokasi (GPS).');
        return;
    }

    navigator.geolocation.watchPosition(
        (pos) => {
            currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            validasiStatusAbsensi();
        },
        (err) => {
            ubahStatusLokasi('error', 'Izin GPS ditolak atau sinyal lemah.');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
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
        dom.bannerLoc.className = "bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-xs flex items-start gap-3";
        dom.iconLocWrapper.className = "p-2 rounded-xl bg-amber-100 text-amber-600 shrink-0";
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
        dom.camPlaceholder.innerHTML = '<span class="text-rose-500 font-bold text-xs"><i class="fa-solid fa-camera-slash text-2xl mb-2 block"></i>Izin Kamera Ditolak / Tidak Tersedia</span>';
        dom.btnStartCam.classList.remove('hidden');
    }
}
dom.btnStartCam.addEventListener('click', inisialisasiKamera);

// Validasi Form & Tombol Absen
function validasiStatusAbsensi() {
    const tipeAbsen = dom.selType.value;
    const isKameraAktif = stream !== null && dom.video.srcObject !== null;

    if (tipeAbsen === 'TIDAK_HADIR') {
        dom.conKet.classList.remove('hidden');
        ubahStatusLokasi('warning', 'Mode Izin/Cuti: Lokasi GPS diabaikan, namun WAJIB selfie & isi keterangan.');
        
        const keteranganVal = dom.inpKet.value.trim();
        dom.btnAbsen.disabled = !(keteranganVal.length > 0 && isKameraAktif);
    } else {
        dom.conKet.classList.add('hidden');
        
        if (!currentLocation) {
            dom.btnAbsen.disabled = true;
            return;
        }

        const jarak = calculateDistance(KANTOR_LAT, KANTOR_LNG, currentLocation.lat, currentLocation.lng);
        let gpsValid = false;

        if (jarak <= MAKSIMAL_RADIUS_METER) {
            ubahStatusLokasi('success', `Anda di area kantor. (Jarak: ${jarak}m dari lokasi pusat)`);
            gpsValid = true;
        } else {
            ubahStatusLokasi('error', `Di luar area kantor. Jarak: ${jarak}m (Maksimal: ${MAKSIMAL_RADIUS_METER}m)`);
            gpsValid = false;
        }

        dom.btnAbsen.disabled = !(gpsValid && isKameraAktif);
    }
}

dom.selType.addEventListener('change', validasiStatusAbsensi);
dom.inpKet.addEventListener('input', validasiStatusAbsensi);

// Kompresi Foto Selfie Super Cepat (Width 400px, JPEG 50%) -> Upload Ringan & Cepat!
function ambilFotoSelfie() {
    if (!stream) return "";
    try {
        const ctx = dom.canvas.getContext('2d');
        dom.canvas.width = 400;
        dom.canvas.height = 300;
        ctx.translate(dom.canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(dom.video, 0, 0, dom.canvas.width, dom.canvas.height);
        return dom.canvas.toDataURL('image/jpeg', 0.5); 
    } catch(e) {
        return "";
    }
}

// Eksekusi Absensi
dom.btnAbsen.addEventListener('click', async () => {
    dom.btnAbsen.disabled = true;
    
    const tipeAbsen = dom.selType.value;
    const base64Foto = ambilFotoSelfie();
    
    const payloadData = {
        nik: currentUser.nik,
        nama: currentUser.nama,
        type: tipeAbsen,
        lat: currentLocation ? currentLocation.lat : 0,
        lng: currentLocation ? currentLocation.lng : 0,
        keterangan: dom.inpKet.value.trim(),
        photo: base64Foto
    };

    toggleLoading(true, 'Menyimpan kehadiran...');
    dom.msgAbsen.classList.add('hidden');

    try {
        const response = await fetchBackend('submitAbsensi', [payloadData]);
        if (response.success) {
            dom.msgAbsen.textContent = `✅ Absensi Berhasil Disimpan! (${response.time})`;
            dom.msgAbsen.className = "text-center text-xs font-bold mt-4 p-4 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200 animate-fade-in";
            dom.msgAbsen.classList.remove('hidden');
            dom.inpKet.value = '';
        } else {
            throw new Error(response.message);
        }
    } catch (err) {
        dom.msgAbsen.textContent = `⚠️ ${err.message}`;
        dom.msgAbsen.className = "text-center text-xs font-bold mt-4 p-4 rounded-2xl bg-rose-50 text-rose-700 border border-rose-200 animate-fade-in";
        dom.msgAbsen.classList.remove('hidden');
    } finally {
        toggleLoading(false);
        validasiStatusAbsensi();
    }
});

// ADMIN NAVIGASI TAB
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
    
    if(!document.getElementById('filter-date').value) {
        document.getElementById('filter-date').value = new Date().toISOString().split('T')[0];
    }
    loadLaporanAdmin();
});

async function loadDataPegawaiAdmin() {
    const tbody = document.getElementById('table-pegawai-body');
    tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Memuat data karyawan...</td></tr>';
    try {
        const data = await fetchBackend('getPegawai', []);
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-slate-400">Belum ada karyawan terdaftar.</td></tr>';
            return;
        }
        data.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition border-b border-slate-100";
            
            const badgeRole = p.role.toUpperCase() === 'SUPERADMIN' 
                ? '<span class="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-extrabold border border-amber-200">SUPERADMIN</span>' 
                : '<span class="px-2.5 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-extrabold border border-blue-200">PEGAWAI</span>';
                
            tr.innerHTML = `
                <td class="px-5 py-3.5 font-bold text-slate-800">${p.nik}</td>
                <td class="px-5 py-3.5 text-slate-700 font-semibold">${p.nama}</td>
                <td class="px-5 py-3.5">${badgeRole}</td>
                <td class="px-5 py-3.5 text-right">
                    <button onclick="editPegawai('${p.nik}', '${p.nama}', '${p.role}')" class="text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition mr-1" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button onclick="hapusPegawai('${p.nik}')" class="text-rose-500 hover:bg-rose-50 p-2 rounded-lg transition ${p.nik === currentUser.nik ? 'hidden' : ''}" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-rose-500 font-bold">Gagal memuat database.</td></tr>';
    }
}

// Modal Pegawai
const modalPegawai = document.getElementById('modal-pegawai');
document.getElementById('btn-tambah-pegawai').addEventListener('click', () => {
    document.getElementById('form-mode').value = 'add';
    document.getElementById('modal-title').textContent = 'Tambah Karyawan Baru';
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
    if (confirm(`Yakin ingin menghapus NIK ${nik}?`)) {
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
    toggleLoading(true, 'Menyimpan data...');

    try {
        const res = mode === 'add' ? await fetchBackend('addPegawai', [payload]) : await fetchBackend('updatePegawai', [oldNik, payload]);
        if (res.success) loadDataPegawaiAdmin();
        else alert(res.message);
    } catch (e) { alert("Terjadi kesalahan server."); }
    finally { toggleLoading(false); }
});

// LAPORAN PRESENSI + STATISTIK RINGKAS
async function loadLaporanAdmin() {
    const tgl = document.getElementById('filter-date').value;
    if (!tgl) return;
    
    const tbody = document.getElementById('table-laporan-body');
    tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Membuat laporan...</td></tr>';
    
    try {
        const data = await fetchBackend('getLaporan', [tgl]);
        tbody.innerHTML = '';
        
        let cMasuk = 0, cKeluar = 0, cIzin = 0;

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400 font-medium">Tidak ada data kehadiran pada tanggal ini.</td></tr>';
        } else {
            data.forEach(d => {
                if (d.tipe === "MASUK") cMasuk++;
                else if (d.tipe === "KELUAR") cKeluar++;
                else if (d.tipe === "TIDAK_HADIR") cIzin++;

                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50 transition border-b border-slate-100";
                
                let badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                let labelStatus = "✅ MASUK";
                if(d.tipe === "KELUAR") {
                    badgeClass = "bg-amber-50 text-amber-700 border-amber-200";
                    labelStatus = "🏃 PULANG";
                } else if(d.tipe === "TIDAK_HADIR") {
                    badgeClass = "bg-purple-50 text-purple-700 border-purple-200";
                    labelStatus = "📝 IZIN / CUTI";
                }

                tr.innerHTML = `
                    <td class="px-5 py-3.5 font-bold text-slate-800">${d.waktu}</td>
                    <td class="px-5 py-3.5 font-bold text-blue-600">${d.nik}</td>
                    <td class="px-5 py-3.5 font-semibold text-slate-700">${d.nama}</td>
                    <td class="px-5 py-3.5"><span class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold border ${badgeClass}">${labelStatus}</span></td>
                    <td class="px-5 py-3.5 text-slate-600 font-medium">${d.jarak ? d.jarak + ' m' : '-'}</td>
                    <td class="px-5 py-3.5 text-slate-500 max-w-[180px] truncate" title="${d.keterangan || '-'}">${d.keterangan || '-'}</td>
                    <td class="px-5 py-3.5">${d.fotoUrl ? `<a href="${d.fotoUrl}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 hover:bg-blue-50 text-blue-600 rounded-lg text-[11px] font-bold transition border border-slate-200"><i class="fa-solid fa-image"></i> Lihat Foto</a>` : '<span class="text-slate-400">-</span>'}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // Update Counter Statistik Cards
        document.getElementById('stat-masuk').textContent = cMasuk;
        document.getElementById('stat-keluar').textContent = cKeluar;
        document.getElementById('stat-izin').textContent = cIzin;
        document.getElementById('stat-total').textContent = data.length;

    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-rose-500 font-bold">Gagal memuat laporan presensi.</td></tr>';
    }
}

document.getElementById('btn-filter').addEventListener('click', loadLaporanAdmin);

document.getElementById('btn-print').addEventListener('click', () => {
    const tgl = document.getElementById('filter-date').value;
    if(!tgl) { alert("Pilih tanggal laporan lebih dahulu."); return; }
    
    // Tampilkan Info Tanggal Cetak
    const dateObj = new Date(tgl);
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('print-date-info').textContent = `Tanggal Laporan: ${dateObj.toLocaleDateString('id-ID', options)}`;
    window.print();
});