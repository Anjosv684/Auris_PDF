; Itens no menu do botão direito do Explorer para arquivos .pdf
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir" "" "Comprimir com Auris PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir" "Icon" "$INSTDIR\AurisPDF.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir\command" "" '"$INSTDIR\AurisPDF.exe" --comprimir "%1"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar" "" "Juntar com Auris PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar" "Icon" "$INSTDIR\AurisPDF.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar\command" "" '"$INSTDIR\AurisPDF.exe" --juntar "%1"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisAbrir" "" "Abrir com Auris PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisAbrir" "Icon" "$INSTDIR\AurisPDF.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisAbrir\command" "" '"$INSTDIR\AurisPDF.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisComprimir"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisJuntar"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\AurisAbrir"
!macroend
