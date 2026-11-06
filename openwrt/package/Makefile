include $(TOPDIR)/rules.mk

PKG_NAME:=vless-lite
PKG_VERSION:=0.2.0
PKG_RELEASE:=1
PKG_LICENSE:=MPL-2.0

include $(INCLUDE_DIR)/package.mk

define Package/vless-lite-core
  SECTION:=net
  CATEGORY:=Network
  TITLE:=VLESS Lite Xray core
  DEPENDS:=@TARGET_ath79 +ca-bundle
endef

define Package/vless-lite-manager
  SECTION:=net
  CATEGORY:=Network
  TITLE:=VLESS Lite LuCI manager
  PKGARCH:=all
  DEPENDS:=+vless-lite-core +firewall4 +luci-base +rpcd +jsonfilter +flock
endef

define Package/vless-lite-manager/conffiles
/etc/config/vless-lite
endef

define Build/Compile
endef

define Package/vless-lite-core/preinst
#!/bin/sh
[ -z "$${IPKG_INSTROOT}" ] || exit 0
[ -d /overlay ] || exit 0
available=$$(df -Pk /overlay | awk 'NR == 2 { print $$4 }')
if [ "$${available:-0}" -lt 26624 ]; then
	echo 'VLESS Lite Core needs 26 MiB free for unpacking. Use the integrated SquashFS build on DIR-869.' >&2
	exit 1
fi
endef

define Package/vless-lite-core/install
	$(INSTALL_DIR) $(1)/usr/bin $(1)/usr/share/licenses/xray-lite
	$(INSTALL_BIN) ./files/usr/bin/xray-lite $(1)/usr/bin/
	$(INSTALL_DATA) ./files/usr/share/licenses/xray-lite/LICENSE $(1)/usr/share/licenses/xray-lite/
endef

define Package/vless-lite-manager/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/etc/vless-lite
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd $(1)/usr/share/vless-lite
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d $(1)/usr/share/luci/menu.d
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/vless-lite
	$(INSTALL_CONF) ./files/etc/config/vless-lite $(1)/etc/config/
	$(INSTALL_BIN) ./files/etc/init.d/vless-lite $(1)/etc/init.d/
	$(INSTALL_DATA) ./files/etc/vless-lite/config.json $(1)/etc/vless-lite/
	$(INSTALL_BIN) ./files/usr/libexec/rpcd/vless-lite $(1)/usr/libexec/rpcd/
	$(INSTALL_BIN) ./files/usr/share/vless-lite/firewall $(1)/usr/share/vless-lite/
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/*.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/*.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/vless-lite/settings.js $(1)/www/luci-static/resources/view/vless-lite/
endef

$(eval $(call BuildPackage,vless-lite-core))
$(eval $(call BuildPackage,vless-lite-manager))

