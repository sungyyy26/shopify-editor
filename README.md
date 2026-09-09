# Shopify Editor

조건(제목/상태/태그/URL 핸들)에 맞는 Shopify 상품을 찾아 제목·설명·미디어를 일괄 수정하는 도구.

## 설정

1. Shopify Dev Dashboard에서 앱을 만들고 아래를 설정합니다.
   - Admin API scopes: `read_products`, `write_products`, `read_files`
   - 허용된 리디렉션 URL(s)에 `http://localhost:3000/auth/callback` 추가
   - API credentials(자격 증명) 탭에서 클라이언트 ID / 클라이언트 시크릿(암호) 확인
2. `.env` 파일 생성:
   ```
   cp .env.example .env
   ```
   그리고 `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_KEY`(클라이언트 ID), `SHOPIFY_API_SECRET`(클라이언트 시크릿)을 입력합니다.
3. 서버 실행 (설치 필요 없음):
   ```
   node server.js
   ```
4. `http://localhost:3000` 접속 후 **Shopify 연결하기** 버튼을 눌러 OAuth 인증을 완료합니다. 완료되면 Admin API 액세스 토큰이 자동으로 `.env`에 저장됩니다.

## 동작 방식

- **조건**: 제목/URL 핸들/태그/상태 중 하나 이상 입력하면 해당 조건으로 상품을 검색합니다. 상태는 복수 선택 가능하며 "전체 상태" 선택 시 상태 필터는 무시됩니다.
- **수정사항**
  - 제목/설명(HTML): 값을 입력한 필드만 수정됩니다.
  - 미디어: "정보"에 입력한 제목으로 쇼피파이에 이미 등록된 이미지를 검색해서 가져옵니다 (새로 업로드하지 않음). "정보"를 비워두면 미디어는 전혀 건드리지 않습니다.
    - **삽입**: 지정한 순서에 이미지를 끼워넣고, 기존 해당 순서 이후 이미지들은 한 칸씩 뒤로 밀립니다.
    - **덮어쓰기**: 지정한 순서의 기존 이미지만 새 이미지로 교체합니다 (다른 이미지 순서는 그대로).

## 참고

- 검색 결과는 최대 250개까지 조회됩니다.
- "미게시" 상태는 Shopify의 `published_status:unpublished`(온라인 스토어에 게시되지 않음)로 매핑했습니다. 스토어의 실제 상태 체계와 다르면 `src/queries.js`의 `STATUS_CLAUSE`를 조정하세요.
