// --- KONFIGURASI APLIKASI ---
const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbyZ3Ch8_bHJNntp6rPmtKZEaRsgZieFNwLvybarSnZRSA7eo_G0XBtnFZKL65VH2tbo1Q/exec"; // PASTE URL WEB APP APPS SCRIPT DI SINI
const KANTOR_LAT = -5.300651890054125;
const KANTOR_LNG = 105.03454645519633;
const MAKSIMAL_RADIUS_METER = 30; // Radius Maksimal

let currentUser = null;
let currentLocation = null;
let stream = null;
let deferredPrompt = null;

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

// MENCEGAH PULL-TO-REFRESH DI HP PADA CONTAINER UTAMA
document.addEventListener('touchmove', function(event) {
    const isScrollable = event.target.closest('.overflow-x-auto') || event.target.closest('.overflow-y-auto') || event.target.tagName === 'TEXTAREA';
    if (!isScrollable) {
        event.preventDefault();
    }
}, { passive: false });

function toggleLoading(show, message = 'Memproses...') {
    dom.textLoad.textContent = message;
    dom.overlayLoad.classList.toggle('hidden', !show);
    dom.overlayLoad.classList.toggle('flex', show);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180;
    const dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return Math.round(R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))));
}

async function fetchBackend(action, params = [], retries = 1) {
    if (!URL_APPS_SCRIPT) throw new Error("URL Apps Script belum diisi!");
    const payloadData = { action: action, parameters: params };

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); 

        try {
            const res = await fetch(URL_APPS_SCRIPT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ payload: JSON.stringify(payloadData) }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error("Server HTTP Error " + res.status);
            return await res.json();
        } catch (err) {
            clearTimeout(timeoutId);
            if (attempt < retries) { await new Promise(r => setTimeout(r, 1000)); continue; }
            throw new Error(err.name === 'AbortError' ? "Koneksi timeout. Pastikan sinyal stabil." : err.message || "Gagal terhubung.");
        }
    }
}

dom.formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputNik = dom.inpNik.value.trim();
    if(!inputNik) return;

    dom.errLogin.classList.add('hidden');
    dom.btnLogin.disabled = true;
    toggleLoading(true, 'Memverifikasi Akses...');

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
        document.getElementById('tab-pegawai').click();
    } else {
        dom.secEmployee.classList.remove('hidden');
        cekStatusHariIni();
        startClock();
    }
}

dom.btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem('e_absensi_session');
    location.reload();
});

function startClock() {
    setInterval(() => {
        const now = new Date();
        document.getElementById('live-clock').textContent = now.toLocaleTimeString('id-ID', { hour12: false });
    }, 1000);
}

let absensiHariIni = { masuk: false, keluar: false, izin: false };

async function cekStatusHariIni() {
    dom.selType.innerHTML = '<option value="">Memeriksa status...</option>';
    dom.selType.disabled = true;
    try {
        const response = await fetchBackend('checkStatus', [currentUser.nik]);
        absensiHariIni = response.data;
        updatePilihanAbsen();
        initCamera();
        if(!absensiHariIni.izin) getLocation();
    } catch (e) {
        dom.selType.innerHTML = '<option value="">Gagal cek status, muat ulang halaman.</option>';
    }
}

function updatePilihanAbsen() {
    let options = '<option value="">-- Pilih Jenis Absen --</option>';
    
    if (absensiHariIni.izin) {
        dom.selType.innerHTML = '<option value="">Anda sudah Izin/Cuti hari ini</option>';
        dom.selType.disabled = true;
        tampilkanPesan(true, "Anda telah mengajukan status Izin/Cuti untuk hari ini.");
        return;
    }

    if (!absensiHariIni.masuk) {
        options += '<option value="MASUK">Absen Masuk (Kantor)</option>';
        options += '<option value="TIDAK_HADIR">Izin / Cuti</option>';
    } else if (!absensiHariIni.keluar) {
        options += '<option value="KELUAR">Absen Pulang (Kantor)</option>';
        tampilkanPesan(true, "Anda sudah absen MASUK. Silakan lakukan absen PULANG.");
    } else {
        dom.selType.innerHTML = '<option value="">Selesai (Masuk & Pulang)</option>';
        dom.selType.disabled = true;
        tampilkanPesan(true, "Anda telah melengkapi absensi MASUK dan PULANG hari ini.");
        return;
    }

    dom.selType.innerHTML = options;
    dom.selType.disabled = false;
}

function getLocation() {
    if (!navigator.geolocation) {
        dom.statLoc.textContent = "Browser tidak support GPS.";
        return;
    }
    navigator.geolocation.watchPosition(
        (position) => {
            currentLocation = position.coords;
            const jarak = calculateDistance(KANTOR_LAT, KANTOR_LNG, currentLocation.latitude, currentLocation.longitude);
            
            if (jarak <= MAKSIMAL_RADIUS_METER) {
                dom.statLoc.innerHTML = `<span class="text-emerald-600 font-extrabold"><i class="fa-solid fa-circle-check"></i> Dalam Radius Kantor (${jarak} m)</span>`;
                dom.iconLocWrapper.className = "p-2 rounded-xl bg-emerald-100 text-emerald-600 shrink-0 shadow-inner";
            } else {
                dom.statLoc.innerHTML = `<span class="text-rose-600 font-extrabold"><i class="fa-solid fa-circle-xmark"></i> Luar Radius Kantor (${jarak} m)</span><br><span class="text-[10px] text-slate-500">Maks. ${MAKSIMAL_RADIUS_METER}m</span>`;
                dom.iconLocWrapper.className = "p-2 rounded-xl bg-rose-100 text-rose-600 shrink-0 shadow-inner";
            }
            validasiKesiapan();
        },
        (error) => {
            dom.statLoc.innerHTML = `<span class="text-amber-600 font-bold"><i class="fa-solid fa-triangle-exclamation"></i> Izin GPS ditolak/gagal.</span>`;
            dom.iconLocWrapper.className = "p-2 rounded-xl bg-amber-100 text-amber-600 shrink-0";
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

async function initCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        dom.video.srcObject = stream;
        dom.video.classList.remove('hidden');
        dom.camPlaceholder.classList.add('hidden');
        dom.badgeLive.classList.replace('hidden', 'flex');
        validasiKesiapan();
    } catch (err) {
        dom.camPlaceholder.innerHTML = `<div class="text-rose-500 font-bold text-xs"><i class="fa-solid fa-video-slash text-xl mb-2 block"></i>Kamera Ditolak / Tidak Tersedia</div>`;
    }
}

dom.selType.addEventListener('change', () => {
    const v = dom.selType.value;
    if (v === 'TIDAK_HADIR') {
        dom.conKet.classList.remove('hidden');
        dom.bannerLoc.classList.add('hidden');
    } else {
        dom.conKet.classList.add('hidden');
        dom.bannerLoc.classList.remove('hidden');
    }
    validasiKesiapan();
});

dom.inpKet.addEventListener('input', validasiKesiapan);

function validasiKesiapan() {
    const tipe = dom.selType.value;
    if (!tipe || !stream) {
        dom.btnAbsen.disabled = true;
        return;
    }
    
    if (tipe === 'TIDAK_HADIR') {
        dom.btnAbsen.disabled = dom.inpKet.value.trim().length < 3;
    } else {
        if (!currentLocation) { dom.btnAbsen.disabled = true; return; }
        const jarak = calculateDistance(KANTOR_LAT, KANTOR_LNG, currentLocation.latitude, currentLocation.longitude);
        dom.btnAbsen.disabled = jarak > MAKSIMAL_RADIUS_METER;
    }
}

function ambilFotoSelfie() {
    const ctx = dom.canvas.getContext('2d');
    // Resolusi dioptimasi (400x300) agar cepat namun tetap layak untuk laporan cetak
    dom.canvas.width = 400; 
    dom.canvas.height = 300;
    
    // Perbaikan flip horizontal pada kamera web
    ctx.translate(dom.canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(dom.video, 0, 0, dom.canvas.width, dom.canvas.height);
    
    // Kompresi JPEG tinggi (0.4) = Sekitar 25KB, sangat cepat dikirim
    return dom.canvas.toDataURL('image/jpeg', 0.4); 
}

dom.btnAbsen.addEventListener('click', async () => {
    const tipe = dom.selType.value;
    const ket = dom.inpKet.value;
    
    if (tipe !== 'TIDAK_HADIR' && (!currentLocation || calculateDistance(KANTOR_LAT, KANTOR_LNG, currentLocation.latitude, currentLocation.longitude) > MAKSIMAL_RADIUS_METER)) {
         return alert("Gagal: Anda di luar radius kantor!");
    }

    dom.btnAbsen.disabled = true;
    toggleLoading(true, "Merekam Kehadiran...");

    const payload = {
        nik: currentUser.nik,
        nama: currentUser.nama,
        type: tipe,
        lat: tipe === 'TIDAK_HADIR' ? "" : currentLocation.latitude,
        lng: tipe === 'TIDAK_HADIR' ? "" : currentLocation.longitude,
        keterangan: ket,
        photo: ambilFotoSelfie()
    };

    try {
        const response = await fetchBackend('submitAbsensi', [payload]);
        if (response.success) {
            tampilkanPesan(true, `Sukses! Absen ${tipe.replace('_',' ')} direkam pada ${response.time}`);
            if(tipe === 'MASUK') absensiHariIni.masuk = true;
            if(tipe === 'KELUAR') absensiHariIni.keluar = true;
            if(tipe === 'TIDAK_HADIR') absensiHariIni.izin = true;
            updatePilihanAbsen();
        } else {
            tampilkanPesan(false, response.message);
        }
    } catch (error) {
        tampilkanPesan(false, error.message);
        dom.btnAbsen.disabled = false;
    } finally {
        toggleLoading(false);
    }
});

function tampilkanPesan(isSuccess, text) {
    dom.msgAbsen.className = `text-center text-xs font-bold mt-4 p-4 rounded-2xl border animate-fade-in ${isSuccess ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`;
    dom.msgAbsen.innerHTML = `<i class="fa-solid ${isSuccess ? 'fa-check-circle' : 'fa-triangle-exclamation'} mr-1"></i> ${text}`;
    dom.msgAbsen.classList.remove('hidden');
}

document.getElementById('tab-pegawai').addEventListener('click', (e) => {
    e.target.className = "flex-1 md:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-xl font-bold text-xs shadow-sm transition ring-1 ring-black/5";
    document.getElementById('tab-laporan').className = "flex-1 md:flex-none px-5 py-2.5 text-slate-500 hover:text-slate-700 rounded-xl font-bold text-xs transition";
    document.getElementById('panel-pegawai').classList.remove('hidden');
    document.getElementById('panel-laporan').classList.add('hidden');
    loadDataPegawaiAdmin();
});

document.getElementById('tab-laporan').addEventListener('click', (e) => {
    e.target.className = "flex-1 md:flex-none px-5 py-2.5 bg-white text-blue-600 rounded-xl font-bold text-xs shadow-sm transition ring-1 ring-black/5";
    document.getElementById('tab-pegawai').className = "flex-1 md:flex-none px-5 py-2.5 text-slate-500 hover:text-slate-700 rounded-xl font-bold text-xs transition";
    document.getElementById('panel-laporan').classList.remove('hidden');
    document.getElementById('panel-pegawai').classList.add('hidden');
});

// UI Filter Interactivity
document.getElementById('filter-type').addEventListener('change', (e) => {
    const val = e.target.value;
    document.getElementById('filter-date').classList.toggle('hidden', val !== 'daily');
    document.getElementById('filter-month').classList.toggle('hidden', val !== 'monthly');
    document.getElementById('filter-year').classList.toggle('hidden', val !== 'yearly');
});

let pegawaiCache = null;

async function loadDataPegawaiAdmin(forceRefresh = false) {
    const tbody = document.getElementById('table-pegawai-body');
    if (pegawaiCache && !forceRefresh) {
        renderTabelPegawai(pegawaiCache);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-slate-400">Memuat data pegawai... <i class="fa-solid fa-spinner fa-spin ml-2"></i></td></tr>';
    try {
        const response = await fetchBackend('getPegawai', []);
        pegawaiCache = Array.isArray(response) ? response : (response.data || []);
        renderTabelPegawai(pegawaiCache);
    } catch (e) { 
        tbody.innerHTML = `<tr><td colspan="4" class="px-5 py-8 text-center text-rose-500 font-bold">${e.message}</td></tr>`; 
    }
}

function renderTabelPegawai(data) {
    const tbody = document.getElementById('table-pegawai-body');
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-slate-400">Tidak ada data pegawai.</td></tr>';
        return;
    }
    data.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-5 py-3.5 font-bold">${p.nik}</td>
            <td class="px-5 py-3.5">${p.nama}</td>
            <td class="px-5 py-3.5"><span class="px-2 py-0.5 bg-blue-100 text-blue-700 font-bold rounded">${p.role}</span></td>
            <td class="px-5 py-3.5 text-right"><button onclick="hapusPegawai('${p.nik}')" class="text-rose-500 font-bold hover:text-rose-700 transition">Hapus</button></td>
        `;
        tbody.appendChild(tr);
    });
}

window.hapusPegawai = async function(nik) {
    if(!confirm("Yakin hapus data pegawai ini?")) return;
    toggleLoading(true, 'Menghapus...');
    try {
        await fetchBackend('deletePegawai', [nik]);
        loadDataPegawaiAdmin(true);
    } catch(err) { alert("Gagal menghapus: " + err.message); } finally { toggleLoading(false); }
};

document.getElementById('btn-filter').addEventListener('click', async () => {
    const fType = document.getElementById('filter-type').value;
    let fValue = '';
    let printTitle = '';
    
    if(fType === 'daily') {
        fValue = document.getElementById('filter-date').value;
        if(!fValue) return alert("Pilih tanggal terlebih dahulu!");
        const parts = fValue.split('-');
        printTitle = `TANGGAL: ${parts[2]}/${parts[1]}/${parts[0]}`;
    } else if (fType === 'monthly') {
        fValue = document.getElementById('filter-month').value;
        if(!fValue) return alert("Pilih bulan terlebih dahulu!");
        const [yyyy, mm] = fValue.split('-');
        const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        printTitle = `BULAN: ${namaBulan[parseInt(mm)-1].toUpperCase()} ${yyyy}`;
    } else if (fType === 'yearly') {
        fValue = document.getElementById('filter-year').value;
        if(!fValue) return alert("Ketikkan tahun terlebih dahulu!");
        printTitle = `TAHUN: ${fValue}`;
    }
    
    window.currentPrintTitle = printTitle;
    const btn = document.getElementById('btn-filter');
    const oriText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading';
    btn.disabled = true;
    
    const tbody = document.getElementById('table-laporan-body');
    const tbodyPrint = document.getElementById('print-table-body');
    
    try {
        const response = await fetchBackend('getLaporan', [fValue, fType]);
        const data = Array.isArray(response) ? response : (response.data || []);
        tbody.innerHTML = '';
        if(tbodyPrint) tbodyPrint.innerHTML = '';
        
        let cMasuk = 0, cKeluar = 0, cIzin = 0;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400 font-medium">Tidak ada data untuk periode ini.</td></tr>';
            if(tbodyPrint) tbodyPrint.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 20px;">Tidak ada data ditemukan.</td></tr>';
        } else {
            data.forEach((d, index) => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50/50 transition-colors border-b border-slate-50";
                
                let badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">${d.tipe}</span>`;
                if(d.tipe === 'MASUK') { cMasuk++; badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700">MASUK</span>`; }
                if(d.tipe === 'KELUAR') { cKeluar++; badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-100 text-blue-700">KELUAR</span>`; }
                if(d.tipe === 'TIDAK_HADIR') { cIzin++; badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-rose-100 text-rose-700">IZIN/CUTI</span>`; }

                tr.innerHTML = `
                    <td class="px-5 py-3.5"><span class="font-bold text-slate-800">${d.tanggal}</span> <br> <span class="text-[10px] text-slate-500 font-medium">${d.waktu}</span></td>
                    <td class="px-5 py-3.5 font-medium text-slate-600">${d.nik}</td>
                    <td class="px-5 py-3.5 font-bold text-slate-800">${d.nama}</td>
                    <td class="px-5 py-3.5">${badgeType}</td>
                    <td class="px-5 py-3.5 text-slate-600 font-medium">${d.jarak ? d.jarak + ' m' : '-'}</td>
                    <td class="px-5 py-3.5 text-xs text-slate-500 truncate max-w-[120px]">${d.keterangan || '-'}</td>
                    <td class="px-5 py-3.5">${d.fotoUrl ? `<a href="${d.fotoUrl}" target="_blank" class="text-blue-500 hover:underline font-bold text-[10px]">Lihat Foto</a>` : '-'}</td>
                `;
                tbody.appendChild(tr);
                
                // Construct Print Rows
                if(tbodyPrint) {
                    const trPrint = document.createElement('tr');
                    trPrint.innerHTML = `
                        <td style="text-align:center;">${index + 1}</td>
                        <td style="text-align:center;"><b>${d.tanggal}</b><br><span style="font-size: 10px; color: #555;">${d.waktu}</span></td>
                        <td style="text-align:center;">${d.nik}</td>
                        <td><b>${d.nama}</b></td>
                        <td style="text-align:center;">${d.tipe}</td>
                        <td style="text-align:center;">${d.jarak ? d.jarak + 'm' : '-'}</td>
                        <td>${d.keterangan || '-'}</td>
                    `;
                    tbodyPrint.appendChild(trPrint);
                }
            });
        }
        
        document.getElementById('stat-total').textContent = data.length;
        document.getElementById('stat-masuk').textContent = cMasuk;
        document.getElementById('stat-keluar').textContent = cKeluar;
        document.getElementById('stat-izin').textContent = cIzin;

    } catch (e) { 
        tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-rose-500 font-bold">Error: ${e.message}</td></tr>`; 
    } finally {
        btn.innerHTML = oriText;
        btn.disabled = false;
    }
});

document.getElementById('btn-print').addEventListener('click', () => {
    if(!window.currentPrintTitle) {
        alert("Pilih parameter filter dan klik Tampilkan terlebih dahulu!");
        return;
    }
    document.getElementById('print-date-info').textContent = "PERIODE " + window.currentPrintTitle;
    
    const today = new Date();
    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    document.getElementById('print-date-signature').textContent = `Jakarta, ${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;
    
    window.print();
});

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    dom.btnInstallPwa.classList.remove('hidden');
});

dom.btnInstallPwa.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') { deferredPrompt = null; dom.btnInstallPwa.classList.add('hidden'); }
    } else {
        alert("Untuk menginstal di iOS/iPhone: Ketuk ikon 'Bagikan' (Share) di browser Safari, lalu pilih 'Tambah ke Layar Utama' (Add to Home Screen).");
    }
});