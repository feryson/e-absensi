// ==========================================
// KONFIGURASI SISTEM
// ==========================================
const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbz_XXXXXXXXX_GANTI_DENGAN_URL_ANDA/exec"; // GANTI DENGAN URL DEPLOY APP SCRIPT ANDA

// Koordinat Kantor (Contoh: Monas, Jakarta)
const KANTOR_LAT = -6.175392;
const KANTOR_LNG = 106.827153;
const MAKSIMAL_RADIUS_METER = 50; // Toleransi jarak absen dalam meter

// Variabel State Global
let currentUser = null;
let currentLat = null;
let currentLng = null;
let currentAccuracy = null;
let currentDistance = null;
let absensiHariIni = { masuk: false, keluar: false, izin: false };
let dataPegawaiCache = [];
let dataAbsensiCache = [];

// DOM Elements Cache
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
// INISIALISASI & PWA
// ==========================================
let deferredPrompt;

window.addEventListener('load', () => {
    // Registrasi Service Worker untuk PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registered!', reg))
            .catch(err => console.error('SW Error', err));
    }

    // Cek Sesi Login Aktif
    const session = sessionStorage.getItem('eAbsenUser');
    if (session) {
        currentUser = JSON.parse(session);
        masukDashboard();
    }
    
    // Live Clock update
    setInterval(updateClock, 1000);
    updateClock();
});

// Menangkap event instalasi PWA
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
        if (outcome === 'accepted') {
            dom.btnPwa.classList.add('hidden');
        }
        deferredPrompt = null;
    } else {
        alert("Untuk menginstal di iOS/iPhone:\n1. Buka di Safari.\n2. Tap ikon Share (Bagikan) di bawah.\n3. Pilih 'Add to Home Screen' (Tambah ke Layar Utama).");
    }
});

// ==========================================
// HELPER: FETCH KE BACKEND APP SCRIPT
// ==========================================
async function fetchBackend(action, params = []) {
    try {
        const response = await fetch(URL_APPS_SCRIPT, {
            method: 'POST',
            body: JSON.stringify({ action: action, params: params }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Fetch Error:", error);
        throw new Error("Koneksi ke server gagal. Periksa sinyal internet Anda.");
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
    const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
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
    toggleLoading(true, 'Verifikasi Akun...');
    
    const btnSubmit = document.getElementById('btn-login');
    btnSubmit.disabled = true;

    try {
        const response = await fetchBackend('cekLoginOnlyNIK', [nik]);
        
        if (response.success) {
            currentUser = { nik: nik, nama: response.nama, role: response.role };
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
        btnSubmit.disabled = false;
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
    
    // Cek status absen hari ini untuk Strict Mode
    toggleLoading(true, "Memeriksa Riwayat Absen...");
    try {
        const status = await fetchBackend('checkStatus', [currentUser.nik]);
        if (status.success) {
            absensiHariIni = status.data;
        }
    } catch (e) {
        console.error("Gagal cek status", e);
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
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, 
            audio: false 
        });
        
        video.srcObject = videoStream;
        video.classList.remove('hidden');
        badge.classList.remove('hidden');
        badge.classList.add('flex');
        placeholder.classList.add('hidden');
    } catch (err) {
        console.error("Kamera error:", err);
        document.getElementById('camera-placeholder').innerHTML = `<div class="text-rose-500 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation text-2xl block mb-2"></i> Akses Kamera Ditolak / Tidak Ditemukan.</div>`;
    }
}

function initGPS() {
    if (!navigator.geolocation) {
        updateStatusGPS(false, "GPS tidak didukung di perangkat ini.");
        return;
    }

    navigator.geolocation.watchPosition(
        (position) => {
            currentLat = position.coords.latitude;
            currentLng = position.coords.longitude;
            currentAccuracy = position.coords.accuracy;
            
            // Perbaikan Fake GPS: Menghapus batas < 2m karena HP modern sangat akurat. 
            // Kita fokus memantau jika akurasi sangat buruk (> 100m)
            if (currentAccuracy > 100) {
                updateStatusGPS(false, `Sinyal GPS Lemah (Akurasi ${Math.round(currentAccuracy)}m). Cari area terbuka.`);
                return;
            }

            currentDistance = hitungJarak(currentLat, currentLng, KANTOR_LAT, KANTOR_LNG);
            validasiJarakAkses();
        },
        (error) => {
            updateStatusGPS(false, "Izinkan akses lokasi (GPS) pada browser Anda.");
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

function hitungJarak(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radius bumi meter
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
}

function updateStatusGPS(isOK, text) {
    dom.locIcon.className = `p-2 rounded-xl shrink-0 ${isOK ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`;
    dom.locIcon.innerHTML = `<i class="fa-solid ${isOK ? 'fa-location-crosshairs' : 'fa-location-dot fa-fade'} text-base"></i>`;
    dom.locStatus.innerHTML = isOK 
        ? `<span class="text-emerald-600 font-bold">${text}</span>` 
        : `<span class="text-rose-500 font-bold">${text}</span>`;
    
    // Jangan ubah status tombol jika sedang Cuti/Izin
    if(dom.selType.value !== 'TIDAK_HADIR') {
        dom.btnAbsen.disabled = !isOK;
    }
}

function validasiJarakAkses() {
    // Bypass GPS jika pilihannya Izin/Cuti
    if(dom.selType.value === 'TIDAK_HADIR') {
        updateStatusGPS(true, "Mode Izin/Cuti (Bebas Radius)");
        dom.btnAbsen.disabled = false;
        return;
    }

    if (currentDistance === null) return;
    
    if (currentDistance <= MAKSIMAL_RADIUS_METER) {
        updateStatusGPS(true, `Dalam Area Kantor (${currentDistance} Meter)`);
    } else {
        updateStatusGPS(false, `Di Luar Radius (${currentDistance} Meter). Maks: ${MAKSIMAL_RADIUS_METER}m`);
    }
}

// ==========================================
// MODUL PEGAWAI: LOGIKA ABSEN & STRICT MODE
// ==========================================
function tampilkanPesan(isSuccess, text, isInfo = false) {
    let colorClass = isSuccess ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200';
    let iconClass = isSuccess ? 'fa-check-circle' : 'fa-triangle-exclamation';
    
    if (isInfo) {
        colorClass = 'bg-blue-50 text-blue-700 border-blue-200';
        iconClass = 'fa-circle-info';
    }

    if(!dom.msgAbsen) return;
    dom.msgAbsen.className = `text-center text-xs font-bold mt-4 p-4 rounded-2xl border animate-fade-in ${colorClass}`;
    dom.msgAbsen.innerHTML = `<i class="fa-solid ${iconClass} mr-1"></i> ${text}`;
    dom.msgAbsen.classList.remove('hidden');
}

function updatePilihanAbsen() {
    let options = '<option value="">-- Pilih Kategori --</option>';
    
    // Aturan 1: Jika sudah Izin, kunci semua
    if (absensiHariIni.izin) {
        dom.selType.innerHTML = '<option value="">Anda sudah Izin/Cuti hari ini</option>';
        dom.selType.disabled = true;
        dom.btnAbsen.disabled = true;
        tampilkanPesan(true, "<b>Selesai:</b> Anda telah terdata Izin/Cuti hari ini.");
        return;
    }

    // Aturan 2: Wajib Masuk Dahulu
    if (!absensiHariIni.masuk) {
        options += '<option value="MASUK">Absen Masuk</option>';
        options += '<option value="TIDAK_HADIR">Izin / Cuti</option>';
        tampilkanPesan(false, "<b>Wajib Absen MASUK:</b> Tombol absen PULANG akan terbuka setelah Anda melakukan absen MASUK hari ini.", true);
    } 
    // Aturan 3: Buka Pulang jika sudah masuk
    else if (!absensiHariIni.keluar) {
        options += '<option value="KELUAR">Absen Pulang</option>';
        tampilkanPesan(true, "Anda sudah terverifikasi absen <b>MASUK</b> hari ini. Silakan pilih Absen <b>PULANG</b> jika jam kerja telah usai.");
    } 
    // Aturan 4: Jika Masuk & Keluar selesai, kunci
    else {
        dom.selType.innerHTML = '<option value="">Absensi Lengkap Hari Ini</option>';
        dom.selType.disabled = true;
        dom.btnAbsen.disabled = true;
        tampilkanPesan(true, "<b>Selesai:</b> Anda telah melengkapi absensi Masuk dan Pulang hari ini.");
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
        updateStatusGPS(true, "Mode Izin/Cuti (Bebas Radius)");
        dom.btnAbsen.disabled = false;
    } else {
        dom.ketContainer.classList.add('hidden');
        dom.inKet.required = false;
        validasiJarakAkses(); // Kembalikan ke mode pantau GPS
    }
});

// Compression helper untuk membuat pengiriman data super cepat
function ambilFotoSelfie() {
    const canvas = document.getElementById('canvas');
    const video = document.getElementById('video');
    if (!video.videoWidth) return null; // Kamera blm siap

    // Kompresi ekstrim (320x240) agar file mentah hanya ~15KB
    const targetWidth = 320; 
    const targetHeight = (video.videoHeight / video.videoWidth) * targetWidth;

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    
    // Mirror the canvas for selfie
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Kualitas gambar diturunkan ke 0.35 (sangat ringan namun wajah tetap terlihat)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.35); 
    return dataUrl.split(',')[1]; // Return only base64 string
}

dom.btnAbsen.addEventListener('click', async () => {
    const tipe = dom.selType.value;
    if (!tipe) return alert("Pilih kategori absensi!");
    
    if (tipe === 'TIDAK_HADIR' && !dom.inKet.value.trim()) {
        return alert("Wajib mengisi alasan/keterangan Izin/Cuti!");
    }

    if (tipe !== 'TIDAK_HADIR' && (currentDistance === null || currentDistance > MAKSIMAL_RADIUS_METER)) {
        return alert("Anda berada di luar radius kantor!");
    }

    dom.btnAbsen.disabled = true;
    toggleLoading(true, "Memproses Data Absensi...");

    try {
        const fotoB64 = ambilFotoSelfie();
        if(!fotoB64) throw new Error("Gagal mengambil foto. Pastikan kamera menyala.");

        const payload = {
            nik: currentUser.nik,
            nama: currentUser.nama,
            type: tipe,
            lat: tipe === 'TIDAK_HADIR' ? 0 : currentLat,
            lng: tipe === 'TIDAK_HADIR' ? 0 : currentLng,
            distance: tipe === 'TIDAK_HADIR' ? 0 : currentDistance,
            note: dom.inKet.value.trim(),
            photoBase64: fotoB64
        };

        const response = await fetchBackend('submitAbsensi', [payload]);
        
        if (response.success) {
            tampilkanPesan(true, `Sukses! Absen ${tipe.replace('_',' ')} direkam pada ${response.time}`);
            
            // Update State Strict Mode
            if(tipe === 'MASUK') absensiHariIni.masuk = true;
            if(tipe === 'KELUAR') absensiHariIni.keluar = true;
            if(tipe === 'TIDAK_HADIR') absensiHariIni.izin = true;
            
            dom.selType.value = "";
            dom.ketContainer.classList.add('hidden');
            dom.inKet.value = "";
            
            setTimeout(() => { updatePilihanAbsen(); }, 2000);
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
// MODUL SUPERADMIN: KELOLA DATA & LAPORAN
// ==========================================
const tabPegawai = document.getElementById('tab-pegawai');
const tabLaporan = document.getElementById('tab-laporan');
const panelPegawai = document.getElementById('panel-pegawai');
const panelLaporan = document.getElementById('panel-laporan');

tabPegawai.addEventListener('click', () => {
    tabPegawai.className = "flex-1 md:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-xl font-bold text-xs shadow-sm transition ring-1 ring-black/5";
    tabLaporan.className = "flex-1 md:flex-none px-5 py-2.5 text-slate-500 hover:text-slate-700 rounded-xl font-bold text-xs transition";
    panelPegawai.classList.remove('hidden');
    panelLaporan.classList.add('hidden');
});

tabLaporan.addEventListener('click', () => {
    tabLaporan.className = "flex-1 md:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-xl font-bold text-xs shadow-sm transition ring-1 ring-black/5";
    tabPegawai.className = "flex-1 md:flex-none px-5 py-2.5 text-slate-500 hover:text-slate-700 rounded-xl font-bold text-xs transition";
    panelLaporan.classList.remove('hidden');
    panelPegawai.classList.add('hidden');
    
    // Set default tanggal filter ke hari ini jika belum di set
    if(!document.getElementById('filter-date').value) {
        document.getElementById('filter-date').value = new Date().toISOString().split('T')[0];
    }
    renderTableLaporan(); 
});

async function loadDataAdmin() {
    toggleLoading(true, "Mengunduh Data Server...");
    try {
        const response = await fetchBackend('getAdminData');
        if (response.success) {
            dataPegawaiCache = response.pegawai;
            dataAbsensiCache = response.absensi;
            renderTablePegawai();
            renderTableLaporan(); // Render the report table right away
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
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-slate-400 font-medium">Tidak ada data pegawai.</td></tr>`;
        return;
    }

    dataPegawaiCache.forEach(d => {
        const roleBadge = d.role === 'SUPERADMIN' 
            ? `<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded-md text-[10px] font-bold"><i class="fa-solid fa-star mr-1"></i>ADMIN</span>`
            : `<span class="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-[10px] font-bold">PEGAWAI</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/50 transition-colors";
        tr.innerHTML = `
            <td class="px-5 py-3.5 font-bold text-slate-800">${d.nik}</td>
            <td class="px-5 py-3.5 whitespace-normal break-words min-w-[150px] font-medium">${d.nama} <br><span class="text-[10px] text-slate-500">${d.jabatan}</span></td>
            <td class="px-5 py-3.5">${roleBadge}</td>
            <td class="px-5 py-3.5 text-right">
                <button class="text-slate-400 hover:text-blue-600 transition p-1"><i class="fa-solid fa-pen-to-square"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// MODUL SUPERADMIN: FILTER & CETAK
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
    renderTableLaporan();
});

function renderTableLaporan() {
    const tbody = document.getElementById('table-laporan-body');
    const pBody = document.getElementById('print-table-body');
    tbody.innerHTML = '';
    pBody.innerHTML = '';
    
    const fType = filterType.value;
    let keyword = "";
    let teksPeriode = "";

    if (fType === 'daily') {
        const d = filterDate.value;
        if(!d) return alert("Pilih tanggal!");
        const dateObj = new Date(d);
        // Format YYYY-MM-DD to DD/MM/YYYY
        keyword = `${String(dateObj.getDate()).padStart(2,'0')}/${String(dateObj.getMonth()+1).padStart(2,'0')}/${dateObj.getFullYear()}`;
        teksPeriode = "TANGGAL: " + keyword;
    } else if (fType === 'monthly') {
        const m = filterMonth.value; // YYYY-MM
        if(!m) return alert("Pilih bulan!");
        const parts = m.split('-');
        keyword = `${parts[1]}/${parts[0]}`; // MM/YYYY
        
        const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        teksPeriode = "BULAN: " + namaBulan[parseInt(parts[1])-1].toUpperCase() + " " + parts[0];
    } else {
        keyword = filterYear.value;
        if(!keyword) return alert("Ketik tahun!");
        teksPeriode = "TAHUN: " + keyword;
    }

    document.getElementById('print-date-info').innerText = "PERIODE: " + teksPeriode;
    
    // Generate tanggal surat (Hari ini)
    const today = new Date();
    const namaBulanToday = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const textToday = `Jakarta, ${today.getDate()} ${namaBulanToday[today.getMonth()]} ${today.getFullYear()}`;
    document.getElementById('print-date-signature').innerText = textToday;

    let cMasuk = 0, cKeluar = 0, cIzin = 0;

    const filteredData = dataAbsensiCache.filter(d => d.tanggal.includes(keyword));

    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400 font-medium">Tidak ada data di periode ini.</td></tr>`;
        updateStatistik(0,0,0,0);
        return;
    }

    filteredData.forEach((d, index) => {
        let badgeType = "";
        let printType = "";
        if(d.tipe === 'MASUK') { 
            cMasuk++; 
            badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700">MASUK</span>`; 
            printType = "MASUK";
        }
        if(d.tipe === 'KELUAR') { 
            cKeluar++; 
            badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-100 text-blue-700">PULANG</span>`; 
            printType = "PULANG";
        }
        if(d.tipe === 'TIDAK_HADIR') { 
            cIzin++; 
            badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-rose-100 text-rose-700">IZIN/CUTI</span>`; 
            printType = "IZIN";
        }

        // Web Table Row (Dengan whitespace-normal agar teks panjang tidak tumpah)
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/50 transition-colors";
        tr.innerHTML = `
            <td class="px-5 py-3.5 whitespace-nowrap"><span class="font-bold text-slate-800">${d.tanggal}</span> <br> <span class="text-[10px] text-slate-500 font-medium">${d.waktu}</span></td>
            <td class="px-5 py-3.5 font-medium text-slate-600 whitespace-nowrap">${d.nik}</td>
            <td class="px-5 py-3.5 font-bold text-slate-800 whitespace-normal break-words min-w-[150px]">${d.nama}</td>
            <td class="px-5 py-3.5 whitespace-nowrap">${badgeType}</td>
            <td class="px-5 py-3.5 text-slate-600 font-medium whitespace-nowrap">${d.jarak ? d.jarak + ' m' : '-'}</td>
            <td class="px-5 py-3.5 text-xs text-slate-500 whitespace-normal break-words min-w-[180px] max-w-[250px]">${d.keterangan || '-'}</td>
            <td class="px-5 py-3.5 whitespace-nowrap text-center">${d.fotoUrl ? `<a href="${d.fotoUrl}" target="_blank" class="text-blue-500 hover:text-blue-700 font-bold text-base" title="Lihat Foto"><i class="fa-solid fa-image"></i></a>` : '-'}</td>
        `;
        tbody.appendChild(tr);

        // Print Table Row (Bebas styling Tailwind, fokus pada CSS @media print)
        const ptr = document.createElement('tr');
        ptr.innerHTML = `
            <td style="text-align:center;">${index + 1}</td>
            <td>${d.tanggal} <br> ${d.waktu}</td>
            <td style="text-align:center;">${d.nik}</td>
            <td>${d.nama}</td>
            <td style="text-align:center; font-weight:bold;">${printType}</td>
            <td style="text-align:center;">${d.jarak ? d.jarak + ' m' : '-'}</td>
            <td>${d.keterangan || '-'}</td>
        `;
        pBody.appendChild(ptr);
    });

    updateStatistik(filteredData.length, cMasuk, cKeluar, cIzin);
}

function updateStatistik(total, masuk, keluar, izin) {
    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-masuk').innerText = masuk;
    document.getElementById('stat-keluar').innerText = keluar;
    document.getElementById('stat-izin').innerText = izin;
}

// Fitur Print Terintegrasi
document.getElementById('btn-print').addEventListener('click', () => {
    const dataAda = document.getElementById('table-laporan-body').children.length;
    if (dataAda === 0 || document.getElementById('table-laporan-body').innerText.includes("Tidak ada data")) {
        alert("Tidak ada data untuk dicetak!");
        return;
    }
    window.print();
});