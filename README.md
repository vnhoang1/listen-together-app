# Listen Together App

Web app nghe YouTube cùng nhau theo phòng, có chat realtime, reaction và hàng chờ chung.

## Tính năng
- Vào phòng theo `roomId`
- Dán link YouTube hoặc `videoId` để thêm bài
- Tự động lấy tiêu đề bài hát từ link nếu bạn để trống ô tiêu đề
- Xóa bài khỏi hàng chờ
- Đảo vị trí bài bằng nút lên/xuống
- Chọn bài để phát ngay
- Phát / tạm dừng / bài tiếp theo sync cơ bản giữa nhiều tab
- Chat và reaction realtime

## Chạy local
```bash
npm install
npm start
```

Mở `http://localhost:3000`

## Deploy lên Render
### Cách 1: dùng `render.yaml`
1. Đưa toàn bộ project này lên GitHub.
2. Vào Render, chọn **New +** -> **Blueprint**.
3. Chọn repo GitHub chứa project.
4. Render sẽ tự đọc file `render.yaml` và deploy.

### Cách 2: tạo Web Service thủ công
- **Environment:** Node
- **Build Command:** `npm install`
- **Start Command:** `npm start`

## Biến môi trường
App dùng:
- `PORT`: Render hoặc nền tảng deploy sẽ tự cấp.

## Cách test sau deploy
1. Mở link web được Render cấp.
2. Mở thêm tab ẩn danh hoặc một máy khác.
3. Vào cùng một phòng.
4. Thử thêm bài, xóa bài, đảo vị trí, chat và đồng bộ phát/tạm dừng.

## Ghi chú
- Tiêu đề được lấy bằng oEmbed/noembed, nên cần có internet.
- YouTube embed có thể hiện quảng cáo tùy video.
- State hiện đang lưu trong RAM server, app sẽ reset khi service khởi động lại.
