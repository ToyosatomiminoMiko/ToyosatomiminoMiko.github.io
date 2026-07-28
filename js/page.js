import { createApp } from 'vue';
import { fmt_time } from './utils.js';

export function mountPages() {
    fetch("http://127.0.0.1/api/pages")
        .then(response => response.json())
        .then((pages) => {
            const app = createApp({
                data() { return { pages }; },
                methods: {
                    formatTime(timeString) {
                        const date = new Date(timeString);
                        return fmt_time(date);
                    }
                }
            });
            app.mount('#page_list');
        })
        .catch((error) => console.error("server connection failed:", error));
}