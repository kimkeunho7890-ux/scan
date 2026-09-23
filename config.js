// ===== Appwrite 설정 (Appwrite 콘솔에서 만든 ID와 똑같이 맞춰주세요) =====
window.APP_CONFIG = {
  endpoint:   'https://appwrite.kim-gwajang.com/v1',
  projectId:  'stockscan',      // Appwrite 프로젝트 ID
  bucketId:   'stocklist',      // 재고리스트 CSV를 올리는 버킷
  stockFileId:'stocklist',      // 버킷 안 파일 ID (항상 이 ID로 덮어씀)
  databaseId: 'scan',           // 스캔 결과 저장 DB
  collectionId:'scans'          // 스캔 결과 컬렉션
};