/**
 * Konfigurasi Aplikasi Client-Side
 * Jika mendeploy secara terpisah (misal Github Pages), 
 * ganti URL_APPS_SCRIPT dengan URL Web App dari deployment Google Apps Script Anda.
 */
const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbwS28aW3uV5_OiJsX3DvBvW2Vk3u6mvJQyw2UsXBqqCJ9y71vXSKARQ9sQ6NW21RWP95Q/exec"; // KOSONGKAN JIKA MENGGUNAKAN HTML SERVICE (google.script.run)
// const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfy.../exec"; // CONTOH JIKA EXTERNAL

// Koordinat Kantor Pusat (Sesuaikan di Kode.gs juga)
const KANTOR_LAT = -5.300456628608312;
const KANTOR_LNG = 105.03455748021706;
const MAKSIMAL_RADIUS_METER = 25; // Radius toleransi (meter)

// State Aplikasi
let currentUser = null;
let currentLocation = null;
let currentAccuracy = null;
let stream = null;

// Elemen DOM
const dom = {
    sections: {
        login: document.getElementById('login-section'),
        employee: document.getElementById('employee-section'),
        admin: document.getElementById('admin-section')
    },
    login: {
        form: document.getElementById('login-form'),
        nik: document.getElementById('login-nik'),
        btn: document.getElementById('btn-login'),
        error: document.getElementById('login-error')
    },
    header: {
        userInfo: document.getElementById('user-info'),
        name: document.getElementById('display-name'),
        btnLogout: document.getElementById('btn-logout')
    },
    absen: {
        type: document.getElementById('absen-type'),
        ketContainer: document.getElementById('keterangan-container'),
        keterangan: document.getElementById('absen-keterangan'),
        btn: document.getElementById('btn-absen'),
        message: document.getElementById('absen-message'),
        locStatus: document.getElementById('location-status')
    },
    camera: {
        video: document.getElementById('video'),
        canvas: document.getElementById('canvas'),
        placeholder: document.getElementById('camera-placeholder'),
        btnRestart: document.getElementById('btn-start-camera')
    },
    admin: {
        tabPegawai: document.getElementById('tab-pegawai'),
        tabLaporan: document.getElementById('tab-laporan'),
        panelPegawai: document.getElementById('panel-pegawai'),
        panelLaporan: document.getElementById('panel-laporan'),
        tbodyPegawai: document.getElementById('table-pegawai-body'),
        tbodyLaporan: document.getElementById('table-laporan-body'),
        btnTambah: document.getElementById('btn-tambah-pegawai'),
        btnFilter: document.getElementById('btn-filter'),
        dateFilter: document.getElementById('filter-date'),
        btnPrint: document.getElementById('btn-print')
    },
    modal: {
        overlay: document.getElementById('loading-overlay'),
        text: document.getElementById('loading-text'),
        pegawai: document.getElementById('modal-pegawai'),
        btnClosePegawai: document.getElementById('btn-close-modal'),
        formPegawai: document.getElementById('form-pegawai')
    }
};

// Helper: Show Loading Overlay
function showLoading(msg = 'Memproses...') {
    dom.modal.text.textContent = msg;
    dom.modal.overlay.classList.remove('hidden');
}

function hideLoading() {
    dom.modal.overlay.classList.add('hidden');
}

// Helper: Haversine Formula untuk hitung jarak di client side (estimasi awal)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radius bumi dalam meter
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

// Komunikasi dengan Backend
// Menggunakan google.script.run jika di dalam Apps Script, atau Fetch API jika eksternal
async function callBackend(functionName, args = []) {
    return new Promise((resolve, reject) => {
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            // Berjalan di dalam infrastruktur Google Apps Script HTML Service
            google.script.run
                .withSuccessHandler(resolve)
                .withFailureHandler(reject)
                [functionName].apply(null, args);
        } else if (URL_APPS_SCRIPT) {
            // Berjalan secara mandiri (eksternal, misal Github Pages) menggunakan POST
            const payload = {
                action: functionName,
                parameters: args
            };
            fetch(URL_APPS_SCRIPT, {
                method: 'POST',
                // Mode no-cors ditiadakan agar bisa baca JSON kembalian.
                // Apps Script harus dikonfigurasi mengirimkan header CORS yang tepat 
                // pada fungsi doPost() atau gunakan format x-www-form-urlencoded
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ payload: JSON.stringify(payload) })
            })
            .then(res => res.json())
            .then(resolve)
            .catch(reject);
        } else {
            reject(new Error("Konfigurasi koneksi backend tidak ditemukan."));
        }
    });
}

// Logic: Login
dom.login.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nik = dom.login.nik.value.trim();
    if(!nik) return;

    dom.login.error.classList.add('hidden');
    showLoading('Memverifikasi NIK...');
    dom.login.btn.disabled = true;

    try {
        const response = await callBackend('login', [nik]);
        
        if (response.success) {
            currentUser = response.data;
            dom.header.name.textContent = `${currentUser.nama} (${currentUser.role})`;
            dom.header.userInfo.classList.remove('hidden');
            
            dom.sections.login.classList.add('hidden');
            
            if (currentUser.role === 'superadmin') {
                dom.sections.admin.classList.remove('hidden');
                loadDataPegawai();
            } else {
                dom.sections.employee.classList.remove('hidden');
                initGPS();
                initCamera();
            }
        } else {
            dom.login.error.textContent = response.message || 'NIK tidak ditemukan.';
            dom.login.error.classList.remove('hidden');
        }
    } catch (error) {
        dom.login.error.textContent = 'Gagal terhubung ke server.';
        dom.login.error.classList.remove('hidden');
        console.error(error);
    } finally {
        hideLoading();
        dom.login.btn.disabled = false;
    }
});

// Logic: Logout
dom.header.btnLogout.addEventListener('click', () => {
    currentUser = null;
    dom.header.userInfo.classList.add('hidden');
    dom.sections.employee.classList.add('hidden');
    dom.sections.admin.classList.add('hidden');
    dom.sections.login.classList.remove('hidden');
    dom.login.nik.value = '';
    
    stopCamera();
    currentLocation = null;
    dom.absen.btn.disabled = true;
});


// Logic: GPS Geolocation & Fake GPS Mitigation
function initGPS() {
    dom.absen.locStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin mt-1"></i> Mencari sinyal GPS...';
    
    if (!navigator.geolocation) {
        dom.absen.locStatus.innerHTML = '<span class="text-red-600"><i class="fa-solid fa-triangle-exclamation"></i> GPS tidak didukung browser ini.</span>';
        return;
    }

    const options = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0 // Hindari cache lokasi (Fake GPS sering menggunakan cache)
    };

    navigator.geolocation.watchPosition(
        (position) => {
            currentLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            currentAccuracy = position.coords.accuracy;

            // FIX: Validasi Fake GPS dengan akurasi < 2 meter DIMATIKAN
            // Alasan: HP masa kini sering mendapat akurasi sangat tinggi secara asli (False Positive)
            /*
            if (currentAccuracy < 2) {
                 dom.absen.locStatus.innerHTML = '<span class="text-red-600"><i class="fa-solid fa-shield-virus"></i> Terdeteksi aktivitas mencurigakan (Fake GPS). Harap gunakan GPS asli.</span>';
                 dom.absen.btn.disabled = true;
                 return;
            }
            */

            const dist = calculateDistance(KANTOR_LAT, KANTOR_LNG, currentLocation.lat, currentLocation.lng);
            
            if (dist <= MAKSIMAL_RADIUS_METER) {
                dom.absen.locStatus.innerHTML = `<span class="text-green-700 font-semibold"><i class="fa-solid fa-check-circle"></i> Berada dalam radius (Jarak: ${dist}m, Akurasi: ${Math.round(currentAccuracy)}m)</span>`;
                checkReadyToAbsen();
            } else {
                dom.absen.locStatus.innerHTML = `<span class="text-red-600"><i class="fa-solid fa-ban"></i> Di luar jangkauan! Jarak: ${dist}m (Maks: ${MAKSIMAL_RADIUS_METER}m).</span>`;
                dom.absen.btn.disabled = true;
            }
        },
        (error) => {
            let msg = "Gagal mengambil lokasi.";
            if(error.code == 1) msg = "Akses lokasi ditolak. Izinkan GPS di pengaturan browser.";
            dom.absen.locStatus.innerHTML = `<span class="text-red-600"><i class="fa-solid fa-triangle-exclamation"></i> ${msg}</span>`;
            dom.absen.btn.disabled = true;
        },
        options
    );
}

// Logic: Camera (Front Camera Only)
async function initCamera() {
    dom.camera.placeholder.classList.remove('hidden');
    dom.camera.video.classList.add('hidden');
    dom.camera.btnRestart.classList.add('hidden');

    try {
        // Request strictly front camera
        const constraints = {
            video: {
                facingMode: "user", // Memaksa kamera depan
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        dom.camera.video.srcObject = stream;
        
        dom.camera.video.onloadedmetadata = () => {
            dom.camera.placeholder.classList.add('hidden');
            dom.camera.video.classList.remove('hidden');
            checkReadyToAbsen();
        };

    } catch (err) {
        console.error("Camera error:", err);
        dom.camera.placeholder.innerHTML = '<span class="text-red-500"><i class="fa-solid fa-video-slash text-3xl mb-2"></i><br>Kamera gagal diakses. Pastikan izin diberikan.</span>';
        dom.camera.btnRestart.classList.remove('hidden');
        dom.absen.btn.disabled = true;
    }
}

dom.camera.btnRestart.addEventListener('click', initCamera);

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    dom.camera.video.classList.add('hidden');
}

function takeSnapshot() {
    if(!stream) return null;
    const canvas = dom.camera.canvas;
    const video = dom.camera.video;
    
    // Set canvas dimension same as video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    
    // Mirror the canvas before drawing so the saved image matches the screen preview
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Kembalikan ke format base64
    return canvas.toDataURL('image/jpeg', 0.8);
}

// Logic: Check readiness
function checkReadyToAbsen() {
    const tipe = dom.absen.type.value;
    // Jika tidak hadir, tidak butuh GPS radius, tapi wajib isi alasan
    if (tipe === 'TIDAK_HADIR') {
        const ket = dom.absen.keterangan.value.trim();
        // FIX: Sistem bisa langsung klik absen meski lokasi belum terkunci (!currentLocation diabaikan)
        dom.absen.btn.disabled = ket.length === 0 || !stream; 
    } else {
        // Harus ada lokasi, dalam jangkauan (sudah dicek di initGPS), dan kamera nyala
        const inRadius = dom.absen.locStatus.textContent.includes('Berada dalam radius');
        dom.absen.btn.disabled = !inRadius || !stream || !currentLocation;
    }
}

dom.absen.type.addEventListener('change', (e) => {
    if (e.target.value === 'TIDAK_HADIR') {
        dom.absen.ketContainer.classList.remove('hidden');
        // Reset GPS Warning untuk tipe tidak hadir agar bisa submit
        dom.absen.locStatus.innerHTML = '<span class="text-blue-600"><i class="fa-solid fa-info-circle"></i> Mode Tidak Hadir. Validasi Radius GPS dinonaktifkan.</span>';
    } else {
        dom.absen.ketContainer.classList.add('hidden');
        dom.absen.keterangan.value = ''; // Reset
        // Force refresh GPS info if possible
        if(currentLocation) {
            const dist = calculateDistance(KANTOR_LAT, KANTOR_LNG, currentLocation.lat, currentLocation.lng);
            if (dist <= MAKSIMAL_RADIUS_METER) {
                dom.absen.locStatus.innerHTML = `<span class="text-blue-700 font-semibold"><i class="fa-solid fa-check-circle"></i> Berada dalam radius.</span>`;
            } else {
                dom.absen.locStatus.innerHTML = `<span class="text-red-600"><i class="fa-solid fa-ban"></i> Di luar jangkauan!</span>`;
            }
        }
    }
    checkReadyToAbsen();
});
dom.absen.keterangan.addEventListener('input', checkReadyToAbsen);


// Logic: Submit Absensi
dom.absen.btn.addEventListener('click', async () => {
    const photoBase64 = takeSnapshot();
    if (!photoBase64) {
        alert("Gagal mengambil foto. Pastikan kamera menyala.");
        return;
    }

    const payload = {
        nik: currentUser.nik,
        nama: currentUser.nama,
        type: dom.absen.type.value,
        lat: currentLocation ? currentLocation.lat : 0,
        lng: currentLocation ? currentLocation.lng : 0,
        accuracy: currentAccuracy || 0,
        keterangan: dom.absen.keterangan.value,
        photo: photoBase64
    };

    dom.absen.btn.disabled = true;
    showLoading('Menyimpan data dan mengunggah foto...');
    dom.absen.message.classList.add('hidden');

    try {
        const response = await callBackend('submitAbsensi', [payload]);
        if (response.success) {
            dom.absen.message.textContent = `Berhasil! Waktu: ${response.time}`;
            dom.absen.message.className = "text-center text-sm font-bold mt-4 text-blue-600 bg-blue-100 p-2 rounded";
            dom.absen.message.classList.remove('hidden');
            
            // Reset state
            dom.absen.keterangan.value = '';
            setTimeout(() => {
                dom.absen.message.classList.add('hidden');
            }, 5000);
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        dom.absen.message.textContent = `Gagal: ${error.message}`;
        dom.absen.message.className = "text-center text-sm font-bold mt-4 text-red-600 bg-red-100 p-2 rounded";
        dom.absen.message.classList.remove('hidden');
    } finally {
        hideLoading();
        checkReadyToAbsen(); // Re-evaluate btn state
    }
});


// ==========================================
// SUPERADMIN LOGIC
// ==========================================

// Tabs
dom.admin.tabPegawai.addEventListener('click', () => {
    dom.admin.panelPegawai.classList.remove('hidden');
    dom.admin.panelLaporan.classList.add('hidden');
    dom.admin.tabPegawai.className = "px-4 py-2 bg-blue-100 text-blue-800 rounded font-semibold text-sm";
    dom.admin.tabLaporan.className = "px-4 py-2 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded font-semibold text-sm";
    loadDataPegawai();
});

dom.admin.tabLaporan.addEventListener('click', () => {
    dom.admin.panelPegawai.classList.add('hidden');
    dom.admin.panelLaporan.classList.remove('hidden');
    dom.admin.tabLaporan.className = "px-4 py-2 bg-blue-100 text-blue-800 rounded font-semibold text-sm";
    dom.admin.tabPegawai.className = "px-4 py-2 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded font-semibold text-sm";
    
    // Set default date today
    if(!dom.admin.dateFilter.value) {
        const today = new Date().toISOString().split('T')[0];
        dom.admin.dateFilter.value = today;
    }
});

// Pegawai Management
async function loadDataPegawai() {
    dom.admin.tbodyPegawai.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center"><div class="loader"></div> Memuat data...</td></tr>';
    try {
        const data = await callBackend('getPegawai', []);
        dom.admin.tbodyPegawai.innerHTML = '';
        
        if (data.length === 0) {
            dom.admin.tbodyPegawai.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center">Belum ada data pegawai.</td></tr>';
            return;
        }

        data.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = "bg-white border-b hover:bg-gray-50";
            tr.innerHTML = `
                <td class="px-4 py-3 font-medium text-gray-900">${p.nik}</td>
                <td class="px-4 py-3">${p.nama}</td>
                <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs ${p.role==='superadmin'?'bg-purple-100 text-purple-800':'bg-blue-100 text-blue-800'}">${p.role}</span></td>
                <td class="px-4 py-3 text-right">
                    <button onclick="editPegawai('${p.nik}', '${p.nama}', '${p.role}')" class="text-blue-600 hover:text-blue-800 mr-3"><i class="fa-solid fa-edit"></i></button>
                    <button onclick="hapusPegawai('${p.nik}')" class="text-red-600 hover:text-red-800 ${p.nik === currentUser.nik ? 'hidden' : ''}"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            dom.admin.tbodyPegawai.appendChild(tr);
        });
    } catch (error) {
        dom.admin.tbodyPegawai.innerHTML = `<tr><td colspan="4" class="px-4 py-4 text-center text-red-500">Gagal memuat data.</td></tr>`;
    }
}

// Modal Form Pegawai
dom.admin.btnTambah.addEventListener('click', () => {
    document.getElementById('form-mode').value = 'add';
    document.getElementById('modal-title').textContent = 'Tambah Pegawai Baru';
    document.getElementById('pegawai-nik').value = '';
    document.getElementById('pegawai-nama').value = '';
    document.getElementById('pegawai-role').value = 'pegawai';
    dom.modal.pegawai.classList.remove('hidden');
});

dom.modal.btnClosePegawai.addEventListener('click', () => {
    dom.modal.pegawai.classList.add('hidden');
});

// Global functions for inline HTML event handlers (Edit/Delete)
window.editPegawai = function(nik, nama, role) {
    document.getElementById('form-mode').value = 'edit';
    document.getElementById('original-nik').value = nik;
    document.getElementById('modal-title').textContent = 'Ubah Data Pegawai';
    document.getElementById('pegawai-nik').value = nik;
    document.getElementById('pegawai-nama').value = nama;
    document.getElementById('pegawai-role').value = role;
    dom.modal.pegawai.classList.remove('hidden');
};

window.hapusPegawai = async function(nik) {
    if(confirm(`Yakin ingin menghapus pegawai dengan NIK ${nik}?`)) {
        showLoading('Menghapus data...');
        try {
            const res = await callBackend('deletePegawai', [nik]);
            if(res.success) loadDataPegawai();
            else alert(res.message);
        } catch(e) { alert("Error"); }
        finally { hideLoading(); }
    }
};

dom.modal.formPegawai.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.getElementById('form-mode').value;
    const oldNik = document.getElementById('original-nik').value;
    
    const payload = {
        nik: document.getElementById('pegawai-nik').value.trim(),
        nama: document.getElementById('pegawai-nama').value.trim(),
        role: document.getElementById('pegawai-role').value
    };

    dom.modal.pegawai.classList.add('hidden');
    showLoading('Menyimpan data...');

    try {
        let res;
        if (mode === 'add') {
            res = await callBackend('addPegawai', [payload]);
        } else {
            res = await callBackend('updatePegawai', [oldNik, payload]);
        }
        
        if (res.success) loadDataPegawai();
        else alert(res.message);
    } catch (error) {
        alert("Gagal menyimpan data.");
    } finally {
        hideLoading();
    }
});


// Laporan Management
dom.admin.btnFilter.addEventListener('click', async () => {
    const tgl = dom.admin.dateFilter.value;
    if(!tgl) return;

    dom.admin.tbodyLaporan.innerHTML = '<tr><td colspan="7" class="px-4 py-4 text-center"><div class="loader"></div> Mengambil data absen...</td></tr>';
    
    try {
        const data = await callBackend('getLaporan', [tgl]);
        dom.admin.tbodyLaporan.innerHTML = '';
        
        if (data.length === 0) {
            dom.admin.tbodyLaporan.innerHTML = '<tr><td colspan="7" class="px-4 py-4 text-center">Tidak ada data absen pada tanggal ini.</td></tr>';
            return;
        }

        data.forEach(d => {
            const tr = document.createElement('tr');
            tr.className = "bg-white border-b hover:bg-gray-50";
            
            // Styling badges
            let badgeColor = "bg-green-100 text-green-800";
            if(d.tipe === 'KELUAR') badgeColor = "bg-blue-100 text-blue-800";
            if(d.tipe === 'TIDAK_HADIR') badgeColor = "bg-red-100 text-red-800";
            
            // Jarak styling
            let jarakText = d.jarak;
            if (d.tipe !== 'TIDAK_HADIR') {
                jarakText = d.jarak > MAKSIMAL_RADIUS_METER 
                    ? `<span class="text-red-600 font-bold">${d.jarak} <i class="fa-solid fa-triangle-exclamation" title="Di luar radius"></i></span>`
                    : `<span class="text-green-600">${d.jarak}</span>`;
            } else {
                jarakText = "-";
            }

            tr.innerHTML = `
                <td class="px-4 py-2">${d.waktu}</td>
                <td class="px-4 py-2 font-medium">${d.nik}</td>
                <td class="px-4 py-2">${d.nama}</td>
                <td class="px-4 py-2"><span class="px-2 py-1 rounded text-[10px] font-bold ${badgeColor}">${d.tipe}</span></td>
                <td class="px-4 py-2">${jarakText}</td>
                <td class="px-4 py-2 text-xs truncate max-w-[150px]" title="${d.keterangan || '-'}">${d.keterangan || '-'}</td>
                <td class="px-4 py-2">
                    ${d.fotoUrl ? `<a href="${d.fotoUrl}" target="_blank" class="text-blue-500 hover:underline"><i class="fa-solid fa-image"></i> Lihat</a>` : '-'}
                </td>
            `;
            dom.admin.tbodyLaporan.appendChild(tr);
        });
    } catch (error) {
        dom.admin.tbodyLaporan.innerHTML = `<tr><td colspan="7" class="px-4 py-4 text-center text-red-500">Gagal memuat laporan.</td></tr>`;
    }
});

// Cetak Laporan
dom.admin.btnPrint.addEventListener('click', () => {
    const tgl = dom.admin.dateFilter.value;
    if(!tgl) {
        alert("Pilih tanggal terlebih dahulu");
        return;
    }
    
    // Set print headers
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = new Date(tgl).toLocaleDateString('id-ID', options);
    document.getElementById('print-date-info').textContent = `Tanggal: ${formattedDate}`;
    
    // Trigger browser print dialog
    window.print();
});

// ==========================================
// PWA SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('PWA Service Worker berhasil didaftarkan'))
            .catch(err => console.error('PWA Service Worker gagal didaftarkan', err));
    });
}