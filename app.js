// --- KONFIGURASI APLIKASI ---
const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbxWaYwu_U4ArudDpQtRjWDV1gSoBQGvNyMuWiCcsdPK2LitUKruR2mZKsm12WRFQxx2_g/exec"; // PASTE URL WEB APP APPS SCRIPT DI SINI
const KANTOR_LAT = -5.300651890054125;
const KANTOR_LNG = 105.03454645519633;
const MAKSIMAL_RADIUS_METER = 30; // Radius Maksimal

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

// MENCEGAH PULL-TO-REFRESH DI HP
document.addEventListener('touchmove', function(event) {
    const isScrollable = event.target.closest('.overflow-x-auto') || event.target.closest('.overflow-y-auto');
    if (!isScrollable) {
        event.preventDefault();
    }
}, { passive: false });

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

// Bridge API Cepat dengan Timeout Handler (Anti Freeze)
async function fetchBackend(action, params = []) {
    return new Promise((resolve, reject) => {
        if (!URL_APPS_SCRIPT) return reject(new Error("URL Apps Script belum diisi!"));
        const payloadData = { action: action, parameters: params };
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 detik timeout

        fetch(URL_APPS_SCRIPT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ payload: JSON.stringify(payloadData) }),
            signal: controller.signal
        })
        .then(res => {
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error("Server error " + res.status);
            return res.json();
        })
        .then(resolve)
        .catch(err => {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                reject(new Error("Koneksi timeout. Periksa internet Anda."));
            } else {
                reject(new Error("Koneksi gagal. Cek URL Apps Script / internet Anda."));
            }
        });
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
        cekStatusHariIni();
    }
}

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
        const data = Array.isArray(response) ? response : (response.data || []);
        pegawaiCache = data;
        renderTabelPegawai(data);
    } catch (e) { 
        tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-rose-500 font-bold">Gagal memuat data pegawai: ' + e.message + '</td></tr>'; 
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
    if (confirm(`Hapus NIK ${nik}?`)) {
        toggleLoading(true, 'Menghapus...');
        await fetchBackend('deletePegawai', [nik]);
        pegawaiCache = null;
        toggleLoading(false);
        loadDataPegawaiAdmin(true);
    }
};

const btnFilter = document.getElementById('btn-filter');
if (btnFilter) {
    btnFilter.addEventListener('click', async () => {
        const fType = document.getElementById('filter-type').value;
        let fValue = '';
        let printTitle = '';
        
        if(fType === 'daily') {
            fValue = document.getElementById('filter-date').value;
            if(!fValue) return alert("Pilih tanggal terlebih dahulu!");
            const dateParts = fValue.split('-');
            printTitle = `TANGGAL: ${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
        } else if (fType === 'monthly') {
            fValue = document.getElementById('filter-month').value;
            if(!fValue) return alert("Pilih bulan dan tahun terlebih dahulu!");
            const [yyyy, mm] = fValue.split('-');
            const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
            printTitle = `BULAN: ${namaBulan[parseInt(mm)-1].toUpperCase()} ${yyyy}`;
        } else if (fType === 'yearly') {
            fValue = document.getElementById('filter-year').value;
            if(!fValue) return alert("Ketik tahun terlebih dahulu!");
            printTitle = `TAHUN: ${fValue}`;
        }
        
        window.currentPrintTitle = printTitle;
        
        const tbody = document.getElementById('table-laporan-body');
        const tbodyPrint = document.getElementById('print-table-body');
        
        tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-slate-400 font-medium">Memuat laporan... <i class="fa-solid fa-spinner fa-spin ml-2"></i></td></tr>';
        
        try {
            const response = await fetchBackend('getLaporan', [fValue, fType]);
            const data = Array.isArray(response) ? response : (response.data || []);
            tbody.innerHTML = '';
            if(tbodyPrint) tbodyPrint.innerHTML = '';
            
            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-slate-400 font-medium">Tidak ada data untuk periode ini.</td></tr>';
                if(tbodyPrint) tbodyPrint.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-black">Tidak ada data ditemukan untuk periode ini.</td></tr>';
                return;
            }

            data.forEach((d, index) => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50/50 transition-colors";
                
                let badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">${d.tipe}</span>`;
                if(d.tipe === 'MASUK') badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700"><i class="fa-solid fa-arrow-right-to-bracket mr-1"></i> MASUK</span>`;
                if(d.tipe === 'KELUAR') badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-100 text-blue-700"><i class="fa-solid fa-arrow-right-from-bracket mr-1"></i> KELUAR</span>`;
                if(d.tipe === 'TIDAK_HADIR') badgeType = `<span class="px-2.5 py-1 rounded-md text-[10px] font-bold bg-rose-100 text-rose-700"><i class="fa-solid fa-file-signature mr-1"></i> IZIN/CUTI</span>`;

                tr.innerHTML = `
                    <td class="px-5 py-3.5"><span class="font-bold text-slate-800">${d.tanggal}</span> <br> <span class="text-[10px] text-slate-500 font-medium"><i class="fa-regular fa-clock mr-1"></i>${d.waktu}</span></td>
                    <td class="px-5 py-3.5 font-medium text-slate-600">${d.nik}</td>
                    <td class="px-5 py-3.5 font-bold text-slate-800">${d.nama}</td>
                    <td class="px-5 py-3.5">${badgeType}</td>
                    <td class="px-5 py-3.5 text-slate-600 font-medium">${d.jarak ? d.jarak + ' m' : '-'}</td>
                    <td class="px-5 py-3.5 text-xs text-slate-500 max-w-[200px] truncate" title="${d.keterangan || '-'}">${d.keterangan || '-'}</td>
                `;
                tbody.appendChild(tr);
                
                if(tbodyPrint) {
                    const trPrint = document.createElement('tr');
                    trPrint.innerHTML = `
                        <td class="text-center">${index + 1}</td>
                        <td class="text-center"><b>${d.tanggal}</b><br><span style="font-size: 10px; color: #555;">${d.waktu}</span></td>
                        <td class="text-center">${d.nik}</td>
                        <td><b>${d.nama}</b></td>
                        <td class="text-center">${d.tipe}</td>
                        <td class="text-center">${d.jarak ? d.jarak + 'm' : '-'}</td>
                        <td>${d.keterangan || '-'}</td>
                    `;
                    tbodyPrint.appendChild(trPrint);
                }
            });
        } catch (e) { 
            tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-rose-500 font-bold"><i class="fa-solid fa-triangle-exclamation mr-2"></i> Error memuat data. Coba lagi.</td></tr>'; 
        }
    });
}

// Single Print Event Listener
const btnPrintDoc = document.getElementById('btn-print');
if (btnPrintDoc) {
    btnPrintDoc.addEventListener('click', () => {
        const printInfo = document.getElementById('print-date-info');
        const signatureDate = document.getElementById('print-date-signature');
        
        if (printInfo) {
            if(window.currentPrintTitle) {
                printInfo.textContent = `PERIODE ${window.currentPrintTitle}`;
            } else {
                alert("Silakan klik 'Tampilkan' terlebih dahulu untuk menyaring data yang akan dicetak.");
                return;
            }
        }
        
        if (signatureDate) {
            const today = new Date();
            const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
            signatureDate.textContent = `Jakarta, ${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;
        }
        
        window.print();
    });
}