; Itens no menu do botão direito do Explorer para arquivos .pdf
; MultiSelectModel=Player: o item aparece mesmo com mais de 15 arquivos selecionados
!macro NSIS_HOOK_POSTINSTALL
  ; Ícone dos arquivos .pdf (quando o Auris PDF é o leitor padrão)
  WriteRegStr HKCU "Software\Classes\Documento PDF\DefaultIcon" "" "$INSTDIR\arquivo-pdf.ico"
  WriteRegStr HKCU "Software\Classes\Applications\AurisPDF.exe\DefaultIcon" "" "$INSTDIR\arquivo-pdf.ico"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir" "" "Comprimir com Auris PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir" "Icon" "$INSTDIR\AurisPDF.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir\command" "" '"$INSTDIR\AurisPDF.exe" --comprimir "%1"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar" "" "Juntar com Auris PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar" "Icon" "$INSTDIR\AurisPDF.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar\command" "" '"$INSTDIR\AurisPDF.exe" --juntar "%1"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\AurisImagemPdf" "" "Converter em PDF com Auris PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\AurisImagemPdf" "Icon" "$INSTDIR\AurisPDF.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\AurisImagemPdf" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\AurisImagemPdf\command" "" '"$INSTDIR\AurisPDF.exe" --imagens "%1"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisImprimir" "" "Imprimir com Auris PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisImprimir" "Icon" "$INSTDIR\AurisPDF.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisImprimir" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisImprimir\command" "" '"$INSTDIR\AurisPDF.exe" --imprimir "%1"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisAbrir" "" "Abrir com Auris PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisAbrir" "Icon" "$INSTDIR\AurisPDF.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisAbrir\command" "" '"$INSTDIR\AurisPDF.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisAbrir"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisImprimir"
  DeleteRegKey HKCU "Software\Classes\Applications\AurisPDF.exe\DefaultIcon"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\image\shell\AurisImagemPdf"
!macroend
