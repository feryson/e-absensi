// ==========================================
// KONFIGURASI SISTEM
// ==========================================
const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbxziDtHWHitTLns96hmG0W-E7V6t0TIsCAVegL7oj5V6lsGm_5ZdhTjhEprrgvnU-71pA/exec"; // GANTI DENGAN URL APPS SCRIPT ANDA

// Koordinat Kantor (Contoh)
const KANTOR_LAT = -5.300651890054125;
const KANTOR_LNG = 105.03454645519633;
const MAKSIMAL_RADIUS_METER = 30; // Toleransi jarak absen dalam meter

// State Global Application
let currentUser = null;
let currentLat = null;
let currentLng = null;
let currentAccuracy = null;
let currentDistance = null;
let absensiHariIni = { masuk: false, keluar: false, izin: false };
let dataPegawaiCache = [];
let dataAbsensiCache = [];

// Cache DOM Elements
const dom = {
    loginSec: document.getElementById('login-section'),
    empSec: document.getElementById('employee-section'),
    adminSec: document.getElementById('admin-section'),
    formLogin: document.getElementById('login-form'),
    inNik: document.getElementById('login-nik'),
    errLogin: document.getElementById('login-error'),
    userInfo: document.getElementById('user-info'),
    dispName: document.getElementById('display-name'),
    dispRole: document.getElementById('display-role'),
    btnOut: document.getElementById('btn-logout'),
    locStatus: document.getElementById('location-status'),
    locIcon: document.getElementById('location-icon-wrapper'),
    selType: document.getElementById('absen-type'),
    ketContainer: document.getElementById('keterangan-container'),
    inKet: document.getElementById('absen-keterangan'),
    btnAbsen: document.getElementById('btn-absen'),
    msgAbsen: document.getElementById('absen-message'),
    btnPwa: document.getElementById('btn-install-pwa'),
    loading: document.getElementById('loading-overlay')
};

// ==========================================
// PREVENT PULL-TO-REFRESH DI MOBILE BROWSER
// ==========================================
let touchStartY = 0;
document.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    const touchCurrentY = e.touches[0].clientY;
    const touchDiff = touchCurrentY - touchStartY;
    
    // Mencegah pull down saat scroll berada paling atas
    if (window.scrollY === 0 && touchDiff > 0) {
        if (e.cancelable) e.preventDefault();
    }
}, { passive: false });

// ==========================================
// INISIALISASI & PWA
// ==========================================
let deferredPrompt;

window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Active'))
            .catch(err => console.error('SW Error', err));
    }

    const session = sessionStorage.getItem('eAbsenUser');
    if (session) {
        currentUser = JSON.parse(session);
        masukDashboard();
    }
    
    setInterval(updateClock, 1000);
    updateClock();
});

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    dom.btnPwa.classList.remove('hidden');
    dom.btnPwa.classList.add('flex');
});

dom.btnPwa.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') dom.btnPwa.classList.add('hidden');
        deferredPrompt = null;
    } else {
        alert("Untuk mengunduh di iOS/iPhone:\n1. Buka di Safari.\n2. Tap ikon Share.\n3. Pilih 'Add to Home Screen'.");
    }
});

// ==========================================
// HELPER: FETCH SERVER GOOGLE SCRIPT
// ==========================================
async function fetchBackend(action, parameters = []) {
    try {
        const payload = JSON.stringify({ action: action, parameters: parameters });
        const response = await fetch(URL_APPS_SCRIPT, {
            method: 'POST',
            body: new URLSearchParams({ payload: payload })
        });
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Fetch Error:", error);
        throw new Error("Gagal terhubung ke server. Periksa koneksi internet Anda.");
    }
}

function toggleLoading(show, text = 'Memproses...') {
    if (show) {
        document.getElementById('loading-text').innerText = text;
        dom.loading.classList.remove('hidden');
        dom.loading.classList.add('flex');
    } else {
        dom.loading.classList.add('hidden');
        dom.loading.classList.remove('flex');
    }
}

function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const clockEl = document.getElementById('live-clock');
    if(clockEl) clockEl.innerText = time;
}

// ==========================================
// MODUL LOGIN & SESI
// ==========================================
dom.formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nik = dom.inNik.value.trim();
    if (!nik) return;

    dom.errLogin.classList.add('hidden');
    toggleLoading(true, 'Memverifikasi NIK...');

    try {
        const response = await fetchBackend('login', [nik]);
        
        if (response.success) {
            currentUser = response.data;
            sessionStorage.setItem('eAbsenUser', JSON.stringify(currentUser));
            masukDashboard();
        } else {
            dom.errLogin.innerText = response.message;
            dom.errLogin.classList.remove('hidden');
        }
    } catch (error) {
        dom.errLogin.innerText = error.message;
        dom.errLogin.classList.remove('hidden');
    } finally {
        toggleLoading(false);
    }
});

dom.btnOut.addEventListener('click', () => {
    if(confirm("Apakah Anda yakin ingin keluar?")) {
        sessionStorage.removeItem('eAbsenUser');
        window.location.reload();
    }
});

function masukDashboard() {
    dom.loginSec.classList.add('hidden');
    dom.userInfo.classList.remove('hidden');
    dom.userInfo.classList.add('flex');
    dom.dispName.innerText = currentUser.nama;
    dom.dispRole.innerText = currentUser.role;

    if (currentUser.role === 'SUPERADMIN') {
        dom.adminSec.classList.remove('hidden');
        loadDataAdmin();
    } else {
        dom.empSec.classList.remove('hidden');
        initDashboardPegawai();
    }
}

// ==========================================
// MODUL PEGAWAI: GPS & KAMERA
// ==========================================
let videoStream = null;

async function initDashboardPegawai() {
    initCamera();
    initGPS();
    
    toggleLoading(true, "Mengecek status presensi...");
    try {
        const status = await fetchBackend('checkStatus', [currentUser.nik]);
        if (status.success) {
            absensiHariIni = status.data;
        }
    } catch (e) {
        console.error("Gagal verifikasi status", e);
    } finally {
        toggleLoading(false);
        updatePilihanAbsen();
    }
}

async function initCamera() {
    try {
        const video = document.getElementById('video');
        const placeholder = document.getElementById('camera-placeholder');
        const badge = document.getElementById('live-badge');
        
        videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } }, 
            audio: false 
        });
        
        video.srcObject = videoStream;
        video.classList.remove('hidden');
        badge.classList.remove('hidden');
        badge.classList.add('flex');
        placeholder.classList.add('hidden');
    } catch (err) {
        console.error("Camera access failed:", err);
        document.getElementById('camera-placeholder').innerHTML = `<div class="text-rose-400 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation text-2xl block mb-2"></i> Kamera Ditolak / Tidak Ada</div>`;
    }
}

function initGPS() {
    if (!navigator.geolocation) {
        updateStatusGPS(false, "GPS tidak didukung oleh browser.");
        return;
    }

    navigator.geolocation.watchPosition(
        (position) => {
            currentLat = position.coords.latitude;
            currentLng = position.coords.longitude;
            currentAccuracy = position.coords.accuracy;
            
            if (currentAccuracy > 150) {
                updateStatusGPS(false, `Akurasi Rendah (${Math.round(currentAccuracy)}m). Geser ke area terbuka.`);
                return;
            }

            currentDistance = hitungJarak(currentLat, currentLng, KANTOR_LAT, KANTOR_LNG);
            validasiJarakAkses();
        },
        (error) => {
            updateStatusGPS(false, "Aktifkan lokasi GPS pada HP Anda.");
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

function hitungJarak(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180;
    const dl = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(dp/2) * Math.sin(dp/2) +
              Math.cos(p1) * Math.cos(p2) *
              Math.sin(dl/2) * Math.sin(dl/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
}

function updateStatusGPS(isOK, text) {
    dom.locIcon.className = `p-2.5 rounded-xl shrink-0 ${isOK ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`;
    dom.locIcon.innerHTML = `<i class="fa-solid ${isOK ? 'fa-location-crosshairs' : 'fa-location-dot fa-bounce'} text-base"></i>`;
    dom.locStatus.innerHTML = isOK 
        ? `<span class="text-emerald-400 font-bold">${text}</span>` 
        : `<span class="text-rose-400 font-bold">${text}</span>`;
    
    if(dom.selType.value !== 'TIDAK_HADIR') {
        dom.btnAbsen.disabled = !isOK;
    }
}

function validasiJarakAkses() {
    if(dom.selType.value === 'TIDAK_HADIR') {
        updateStatusGPS(true, "Izin / Cuti (Bebas Radius GPS)");
        dom.btnAbsen.disabled = false;
        return;
    }

    if (currentDistance === null) return;
    
    if (currentDistance <= MAKSIMAL_RADIUS_METER) {
        updateStatusGPS(true, `Dalam Radius Kantor (${currentDistance} Meter)`);
    } else {
        updateStatusGPS(false, `Di Luar Radius (${currentDistance}m). Maks: ${MAKSIMAL_RADIUS_METER}m`);
    }
}

// ==========================================
// PEGAWAI: SUBMIT & STRICT MODE
// ==========================================
function tampilkanPesan(isSuccess, text, isInfo = false) {
    let colorClass = isSuccess ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border-rose-500/20';
    let iconClass = isSuccess ? 'fa-circle-check' : 'fa-triangle-exclamation';
    
    if (isInfo) {
        colorClass = 'bg-brand-500/10 text-brand-300 border-brand-500/20';
        iconClass = 'fa-circle-info';
    }

    if(!dom.msgAbsen) return;
    dom.msgAbsen.className = `text-center text-xs font-bold mt-4 p-3.5 rounded-2xl border animate-fade-in ${colorClass}`;
    dom.msgAbsen.innerHTML = `<i class="fa-solid ${iconClass} mr-1.5"></i> ${text}`;
    dom.msgAbsen.classList.remove('hidden');
}

function updatePilihanAbsen() {
    let options = '<option value="">-- Pilih Status --</option>';
    
    if (absensiHariIni.izin) {
        dom.selType.innerHTML = '<option value="">Status Hari Ini: IZIN / CUTI</option>';
        dom.selType.disabled = true;
        dom.btnAbsen.disabled = true;
        tampilkanPesan(true, "<b>Selesai:</b> Anda tercatat Izin/Cuti hari ini.");
        return;
    }

    if (!absensiHariIni.masuk) {
        options += '<option value="MASUK">Absen Masuk</option>';
        options += '<option value="TIDAK_HADIR">Izin / Cuti</option>';
        tampilkanPesan(false, "Silakan lakukan Absen <b>MASUK</b> terlebih dahulu.", true);
    } 
    else if (!absensiHariIni.keluar) {
        options += '<option value="KELUAR">Absen Pulang</option>';
        tampilkanPesan(true, "Anda telah Absen <b>MASUK</b>. Pilih Absen <b>PULANG</b> di akhir jam kerja.");
    } 
    else {
        dom.selType.innerHTML = '<option value="">Presensi Lengkap Hari Ini</option>';
        dom.selType.disabled = true;
        dom.btnAbsen.disabled = true;
        tampilkanPesan(true, "<b>Selesai:</b> Presensi Masuk dan Pulang lengkap.");
        return;
    }

    dom.selType.innerHTML = options;
    dom.selType.disabled = false;
}

dom.selType.addEventListener('change', (e) => {
    const val = e.target.value;
    
    if (val === 'TIDAK_HADIR') {
        dom.ketContainer.classList.remove('hidden');
        dom.inKet.required = true;
        updateStatusGPS(true, "Mode Izin / Cuti");
        dom.btnAbsen.disabled = false;
    } else {
        dom.ketContainer.classList.add('hidden');
        dom.inKet.required = false;
        validasiJarakAkses();
    }
});

function ambilFotoSelfie() {
    const canvas = document.getElementById('canvas');
    const video = document.getElementById('video');
    if (!video.videoWidth) return "";

    const targetWidth = 320; 
    const targetHeight = (video.videoHeight / video.videoWidth) * targetWidth;

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.35); // Base64 terkompresi super ringan
}

dom.btnAbsen.addEventListener('click', async () => {
    const tipe = dom.selType.value;
    if (!tipe) return alert("Pilih kategori absensi!");
    
    if (tipe === 'TIDAK_HADIR' && !dom.inKet.value.trim()) {
        return alert("Alasan Izin/Cuti wajib diisi!");
    }

    if (tipe !== 'TIDAK_HADIR' && (currentDistance === null || currentDistance > MAKSIMAL_RADIUS_METER)) {
        return alert("Anda berada di luar radius kantor!");
    }

    dom.btnAbsen.disabled = true;
    toggleLoading(true, "Mengirim data presensi...");

    try {
        const photoData = ambilFotoSelfie();

        const payload = {
            nik: currentUser.nik,
            nama: currentUser.nama,
            type: tipe,
            lat: tipe === 'TIDAK_HADIR' ? 0 : currentLat,
            lng: tipe === 'TIDAK_HADIR' ? 0 : currentLng,
            keterangan: dom.inKet.value.trim(),
            photo: photoData
        };

        const response = await fetchBackend('submitAbsensi', [payload]);
        
        if (response.success) {
            tampilkanPesan(true, `Berhasil direkam pukul ${response.time}`);
            
            if(tipe === 'MASUK') absensiHariIni.masuk = true;
            if(tipe === 'KELUAR') absensiHariIni.keluar = true;
            if(tipe === 'TIDAK_HADIR') absensiHariIni.izin = true;
            
            dom.selType.value = "";
            dom.ketContainer.classList.add('hidden');
            dom.inKet.value = "";
            
            setTimeout(() => { updatePilihanAbsen(); }, 1500);
        } else {
            tampilkanPesan(false, response.message);
            dom.btnAbsen.disabled = false;
        }
    } catch (error) {
        tampilkanPesan(false, error.message);
        dom.btnAbsen.disabled = false;
    } finally {
        toggleLoading(false);
    }
});

// ==========================================
// SUPERADMIN: MANAGEMENT & LAPORAN
// ==========================================
const tabPegawai = document.getElementById('tab-pegawai');
const tabLaporan = document.getElementById('tab-laporan');
const panelPegawai = document.getElementById('panel-pegawai');
const panelLaporan = document.getElementById('panel-laporan');

tabPegawai.addEventListener('click', () => {
    tabPegawai.className = "flex-1 md:flex-none px-5 py-2 font-bold text-xs transition shadow-sm bg-brand-600 text-white rounded-xl";
    tabLaporan.className = "flex-1 md:flex-none px-5 py-2 text-slate-400 hover:text-white rounded-xl font-bold text-xs transition";
    panelPegawai.classList.remove('hidden');
    panelLaporan.classList.add('hidden');
});

tabLaporan.addEventListener('click', () => {
    tabLaporan.className = "flex-1 md:flex-none px-5 py-2 font-bold text-xs transition shadow-sm bg-brand-600 text-white rounded-xl";
    tabPegawai.className = "flex-1 md:flex-none px-5 py-2 text-slate-400 hover:text-white rounded-xl font-bold text-xs transition";
    panelLaporan.classList.remove('hidden');
    panelPegawai.classList.add('hidden');
    
    if(!document.getElementById('filter-month').value) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        document.getElementById('filter-month').value = `${yyyy}-${mm}`;
    }
    fetchLaporanFilter();
});

async function loadDataAdmin() {
    toggleLoading(true, "Memuat database server...");
    try {
        const response = await fetchBackend('getAdminData');
        if (response.success) {
            dataPegawaiCache = response.pegawai || [];
            dataAbsensiCache = response.absensi || [];
            renderTablePegawai();
            renderTableLaporan();
        } else {
            alert("Gagal memuat data: " + response.message);
        }
    } catch (e) {
        alert(e.message);
    } finally {
        toggleLoading(false);
    }
}

function renderTablePegawai() {
    const tbody = document.getElementById('table-pegawai-body');
    tbody.innerHTML = '';
    
    if(dataPegawaiCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-slate-500 font-medium">Belum ada data karyawan.</td></tr>`;
        return;
    }

    dataPegawaiCache.forEach(d => {
        const roleBadge = d.role === 'SUPERADMIN' 
            ? `<span class="px-2.5 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg text-[10px] font-bold"><i class="fa-solid fa-star mr-1"></i>SUPERADMIN</span>`
            : `<span class="px-2.5 py-1 bg-slate-800 text-slate-300 rounded-lg text-[10px] font-bold">PEGAWAI</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/30 transition-colors";
        tr.innerHTML = `
            <td class="px-5 py-3 font-bold text-white">${d.nik}</td>
            <td class="px-5 py-3 font-medium text-slate-200">${d.nama}</td>
            <td class="px-5 py-3">${roleBadge}</td>
            <td class="px-5 py-3 text-right space-x-2">
                <button onclick="editPegawaiModal('${d.nik}', '${d.nama}', '${d.role}')" class="text-slate-400 hover:text-brand-400 transition p-1"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="hapusPegawai('${d.nik}')" class="text-slate-400 hover:text-rose-400 transition p-1"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Modal Pegawai CRUD
const modalPegawai = document.getElementById('modal-pegawai');
document.getElementById('btn-add-pegawai').addEventListener('click', () => {
    document.getElementById('modal-title').innerText = "Tambah Karyawan Baru";
    document.getElementById('edit-old-nik').value = "";
    document.getElementById('pegawai-nik').value = "";
    document.getElementById('pegawai-nama').value = "";
    document.getElementById('pegawai-role').value = "PEGAWAI";
    modalPegawai.classList.remove('hidden');
});

document.getElementById('btn-close-modal').addEventListener('click', () => {
    modalPegawai.classList.add('hidden');
});

window.editPegawaiModal = function(nik, nama, role) {
    document.getElementById('modal-title').innerText = "Edit Data Karyawan";
    document.getElementById('edit-old-nik').value = nik;
    document.getElementById('pegawai-nik').value = nik;
    document.getElementById('pegawai-nama').value = nama;
    document.getElementById('pegawai-role').value = role;
    modalPegawai.classList.remove('hidden');
};

document.getElementById('form-pegawai').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldNik = document.getElementById('edit-old-nik').value;
    const nik = document.getElementById('pegawai-nik').value.trim();
    const nama = document.getElementById('pegawai-nama').value.trim();
    const role = document.getElementById('pegawai-role').value;

    toggleLoading(true, "Menyimpan karyawan...");
    try {
        let res;
        if(oldNik) {
            res = await fetchBackend('updatePegawai', [oldNik, { nik, nama, role }]);
        } else {
            res = await fetchBackend('addPegawai', [{ nik, nama, role }]);
        }

        if(res.success) {
            modalPegawai.classList.add('hidden');
            loadDataAdmin();
        } else {
            alert(res.message);
        }
    } catch(err) {
        alert(err.message);
    } finally {
        toggleLoading(false);
    }
});

window.hapusPegawai = async function(nik) {
    if(!confirm(`Hapus karyawan NIK ${nik}?`)) return;
    toggleLoading(true, "Menghapus karyawan...");
    try {
        const res = await fetchBackend('deletePegawai', [nik]);
        if(res.success) loadDataAdmin();
        else alert(res.message);
    } catch(err) {
        alert(err.message);
    } finally {
        toggleLoading(false);
    }
};

// ==========================================
// FILTER LAPORAN & CETAK
// ==========================================
const filterType = document.getElementById('filter-type');
const filterDate = document.getElementById('filter-date');
const filterMonth = document.getElementById('filter-month');
const filterYear = document.getElementById('filter-year');

filterType.addEventListener('change', (e) => {
    const val = e.target.value;
    filterDate.classList.add('hidden');
    filterMonth.classList.add('hidden');
    filterYear.classList.add('hidden');
    
    if(val === 'daily') filterDate.classList.remove('hidden');
    if(val === 'monthly') filterMonth.classList.remove('hidden');
    if(val === 'yearly') filterYear.classList.remove('hidden');
});

document.getElementById('btn-filter').addEventListener('click', () => {
    fetchLaporanFilter();
});

async function fetchLaporanFilter() {
    const fType = filterType.value;
    let filterVal = "";
    let teksPeriode = "";

    if (fType === 'daily') {
        filterVal = filterDate.value;
        if(!filterVal) return alert("Pilih tanggal!");
        const parts = filterVal.split('-');
        teksPeriode = `TANGGAL: ${parts[2]}/${parts[1]}/${parts[0]}`;
    } else if (fType === 'monthly') {
        filterVal = filterMonth.value;
        if(!filterVal) return alert("Pilih bulan!");
        const parts = filterVal.split('-');
        const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        teksPeriode = `BULAN: ${namaBulan[parseInt(parts[1])-1].toUpperCase()} ${parts[0]}`;
    } else {
        filterVal = filterYear.value;
        if(!filterVal) return alert("Masukkan tahun!");
        teksPeriode = `TAHUN: ${filterVal}`;
    }

    document.getElementById('print-date-info').innerText = "PERIODE LAPORAN: " + teksPeriode;
    
    const today = new Date();
    const namaBulanToday = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    document.getElementById('print-date-signature').innerText = `Jakarta, ${today.getDate()} ${namaBulanToday[today.getMonth()]} ${today.getFullYear()}`;

    toggleLoading(true, "Menarik data laporan...");
    try {
        const response = await fetchBackend('getLaporan', [filterVal, fType]);
        if (response.success) {
            dataAbsensiCache = response.data;
            renderTableLaporan();
        } else {
            alert("Gagal memuat laporan: " + response.message);
        }
    } catch(err) {
        alert(err.message);
    } finally {
        toggleLoading(false);
    }
}

function renderTableLaporan() {
    const tbody = document.getElementById('table-laporan-body');
    const pBody = document.getElementById('print-table-body');
    tbody.innerHTML = '';
    pBody.innerHTML = '';
    
    let cMasuk = 0, cKeluar = 0, cIzin = 0;

    if (dataAbsensiCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-500 font-medium">Tidak ditemukan rekaman presensi pada periode ini.</td></tr>`;
        updateStatistik(0,0,0,0);
        return;
    }

    dataAbsensiCache.forEach((d, index) => {
        let badgeType = "";
        let printType = "";
        if(d.tipe === 'MASUK') { 
            cMasuk++; 
            badgeType = `<span class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">MASUK</span>`; 
            printType = "MASUK";
        }
        if(d.tipe === 'KELUAR') { 
            cKeluar++; 
            badgeType = `<span class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-brand-500/10 text-brand-400 border border-brand-500/20">PULANG</span>`; 
            printType = "PULANG";
        }
        if(d.tipe === 'TIDAK_HADIR') { 
            cIzin++; 
            badgeType = `<span class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-rose-500/10 text-rose-400 border border-rose-500/20">IZIN/CUTI</span>`; 
            printType = "IZIN";
        }

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/30 transition-colors";
        tr.innerHTML = `
            <td class="px-4 py-3"><span class="font-bold text-white">${d.tanggal}</span> <span class="text-[10px] text-slate-400 ml-1 font-mono">${d.waktu}</span></td>
            <td class="px-4 py-3 font-mono font-bold text-slate-400">${d.nik}</td>
            <td class="px-4 py-3 font-bold text-slate-200">${d.nama}</td>
            <td class="px-4 py-3">${badgeType}</td>
            <td class="px-4 py-3 font-mono text-slate-300">${d.jarak ? d.jarak + ' m' : '-'}</td>
            <td class="px-4 py-3 text-slate-400 text-xs">${d.keterangan || '-'}</td>
            <td class="px-4 py-3 text-center">${d.fotoUrl ? `<a href="${d.fotoUrl}" target="_blank" class="text-brand-400 hover:text-brand-300 font-bold" title="Lihat Selfie"><i class="fa-solid fa-image text-sm"></i></a>` : '-'}</td>
        `;
        tbody.appendChild(tr);

        // Print Row untuk Dokumen Cetak A4
        const ptr = document.createElement('tr');
        ptr.innerHTML = `
            <td style="text-align:center;">${index + 1}</td>
            <td style="text-align:center;">${d.tanggal}<br><span style="font-size:9px;">${d.waktu}</span></td>
            <td style="text-align:center; font-family:monospace;">${d.nik}</td>
            <td><b>${d.nama}</b></td>
            <td style="text-align:center; font-weight:bold;">${printType}</td>
            <td style="text-align:center;">${d.jarak ? d.jarak + 'm' : '-'}</td>
            <td>${d.keterangan || '-'}</td>
        `;
        pBody.appendChild(ptr);
    });

    updateStatistik(dataAbsensiCache.length, cMasuk, cKeluar, cIzin);
}

function updateStatistik(total, masuk, keluar, izin) {
    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-masuk').innerText = masuk;
    document.getElementById('stat-keluar').innerText = keluar;
    document.getElementById('stat-izin').innerText = izin;
}

// CETAK A4
document.getElementById('btn-print').addEventListener('click', () => {
    if (dataAbsensiCache.length === 0) {
        alert("Tidak ada data laporan untuk dicetak!");
        return;
    }
    window.print();
});