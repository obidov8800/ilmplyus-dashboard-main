import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { loadBackend } from '../_shared/backend';

/**
 * BACKEND MANZILI — butun loyiha uchun BITTA joyda: `D:\ilmplyus\backend.env`
 * (`BACKEND_URL`). Bu yerda, `public/.htaccess`da, `.env`da yoki kodda manzil
 * YOZILMAYDI — hammasi shu yerdan olinadi. Batafsil: `D:\ilmplyus\BACKEND-MANZILI.md`.
 */
const backend = loadBackend(__dirname);

/**
 * Backend manzilini `backend.env`dan qo'llaydi:
 *  • dev — fayl o'zgarsa server O'ZI qayta ishga tushadi (proksi yangi manzilni oladi);
 *  • build — `dist/.htaccess`dagi `/api` va `/storage` qoidalariga manzilni yozadi
 *    (+ deploy skriptlari o'qiydigan `dist/.htbackend` belgisi).
 */
function backendPlugin(): Plugin {
  let outDir = '';
  return {
    name: 'ilmplyus-backend',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      const onFile = (file: string) => {
        if (!backend.isBackendFile(file)) return;
        server.config.logger.info('\x1b[36m[backend]\x1b[0m backend.env o‘zgardi — server qayta ishga tushmoqda…');
        void server.restart();
      };
      server.watcher.add(backend.file);
      server.watcher.on('change', onFile);
      server.watcher.on('add', onFile);
    },
    writeBundle() {
      backend.stamp(outDir);
    },
  };
}

/**
 * Bo'sh (0 bayt) CSS bo'laklarini olib tashlaydi.
 *
 * Vite `lazy` sahifaga CSS import qilinganda, o'sha CSS'ning barcha qoidalari
 * boshqa umumiy bo'lakka birlashib ketsa ham, bo'sh `.css` faylini baribir
 * chiqaradi va JS ichidagi `__vitePreload` unga havola qoldiradi. Ba'zi
 * static-hosting/CDN'lar 0 baytli fayllarni ko'chirmaydi yoki 404 qaytaradi →
 * "Unable to preload CSS ... 404" xatosi (ilova sahifasi ochilmay qoladi).
 * Bu plagin bo'sh CSS asset'larini o'chirib, JS'dagi havolalarini ham tozalaydi.
 *
 * ESLATMA: `build.cssCodeSplit: false` bo'lgani uchun hozir CSS bo'laklari
 * umuman chiqmaydi — bu plagin uxlab turibdi (no-op). `cssCodeSplit` qayta
 * yoqilsa, ehtiyot chorasi sifatida joyida qoladi.
 */
function dropEmptyCssChunks(): Plugin {
  return {
    name: 'drop-empty-css-chunks',
    apply: 'build',
    // Vite'ning CSS + preload-injeksiya plaginlari `enforce: 'post'` — bu
    // hook ulardan KEYIN ishlashi kerak, aks holda bo'sh CSS va uning
    // havolalari qayta qo'shilib qoladi.
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const empty: string[] = [];
        for (const [name, asset] of Object.entries(bundle)) {
          if (
            asset.type === 'asset' &&
            name.endsWith('.css') &&
            String(asset.source ?? '').trim() === ''
          ) {
            empty.push(name);
            delete bundle[name];
          }
        }
        if (empty.length === 0) return;
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          for (const css of empty) {
            chunk.code = chunk.code
              .split(`,"${css}"`).join('')
              .split(`"${css}",`).join('')
              .split(`"${css}"`).join('');
            chunk.viteMetadata?.importedCss?.delete(css);
          }
        }
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropEmptyCssChunks(), backendPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    /*
     * BITTA CSS fayli — sahifalarga bo'linmaydi.
     *
     * `cssCodeSplit: true` (Vite standarti) da bir CSS modul (masalan
     * `finance.css`) bir nechta `lazy` sahifa tomonidan import qilinsa, Vite
     * uni faqat BITTA bo'lakning `importedCss` (preload) ro'yxatiga qo'shadi.
     * Natijada `/jamgarma` yoki moliya sahifasiga to'g'ridan-to'g'ri
     * kirilganda `finance-*.css` `<link>`i umuman ulanmay qolardi —
     * toolbar (qidiruv/filtr/"Qo'shish") uslubsiz ko'rinardi (jadval esa
     * `index.css`dagi umumiy qoidalar bilan bo'yalgani uchun joyida edi).
     * Shu bilan birga eski "Unable to preload CSS ... 404" (0-baytli CSS
     * bo'lak) muammosi ham shu sinfdan edi.
     *
     * `false` — barcha CSS bitta `index-*.css`ga yig'iladi, `index.html`da
     * `<link>` bilan doim ulanadi: preload "raqs"i yo'q, 404 yo'q, noto'g'ri
     * biriktirish yo'q. Admin panel uchun ~1 marta yuklanadigan qo'shimcha
     * ~250KB (gzip ~40KB) muammo emas; asset fayllar soni ham kamayadi.
     */
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        /*
         * Juda mayda JS bo'laklarni qo'shnisiga qo'shib yuboradi — chunklash
         * bosqichida, shuning uchun xesh nomlar to'g'ri qayta hisoblanadi.
         */
        experimentalMinChunkSize: 10_000,
        /*
         * Kutubxonalar alohida bo'laklarda (User ilovasidagi bilan bir xil): ilova kodi yangilanganda (har joylashda)
         * brauzer React/Mantine/TanStack'ni keshdan oladi — qayta yuklamaydi. Ilgari hammasi bitta ~1 MB `index-*.js`
         * ichida edi va har nashrda to'liq qayta yuklanardi. Bu ro'yxatga faqat darhol kerak paketlar qo'yiladi
         * (jspdf, html2canvas kabi og'irlari dinamik import chegarasida o'zi ajraladi).
         */
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
            return 'vendor-react';
          if (/[\\/]node_modules[\\/]@mantine[\\/]/.test(id)) return 'vendor-mantine';
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'vendor-query';
        },
      },
    },
  },
  server: {
    proxy: {
      '/ipt-api': {
        target: 'https://mainoffice.uz:8181',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/ipt-api/, ''),
      },
      /*
       * DEV proxy — `/api` va `/storage` so'rovlari Vite dev serverining
       * o'ziga ketadi, u esa backendga (`backend.env`dagi `BACKEND_URL`)
       * SERVER TOMONIDAN uzatadi. Production'da xuddi shu vazifani Apache
       * bajaradi (`dist/.htaccess`, build paytida shu YAGONA manzildan
       * yoziladi). Kod esa doim nisbiy `/api` ga murojaat qiladi
       * (`src/api/baseUrl.ts`).
       *
       * Natija: brauzer (DevTools > Network) faqat shu saytning o'z domenini
       * ko'radi, backend manzili tashqariga chiqmaydi; CORS ham kerak emas
       * (so'rov bir xil origin ichida qoladi).
       */
      ...backend.proxy,
    },
  },
});
